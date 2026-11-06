package org.totr.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Asking a server to let the person in, the phone's version of the desktop app's joinclient.cjs
 * (the server side is TOTRsrv/auth/join.py). The app signs each request with its install key
 * (InstallKey) and makes up a one-time invite token itself, sending only its SHA-256; when an admin
 * approves, only this app holds the token that opens the invite. The asks in progress are kept in
 * the app's preferences (at most 5, forgotten after 14 days) with their tokens, which never go to
 * the page. All calls block: run them on a worker thread. Every answer is a JSON text for the page:
 * {"joins":[...]} or {"error":"..."}.
 */
final class JoinClient {
  private static final String KEY = "joins";
  private static final int MAX_JOINS = 5;
  private static final long MAX_AGE_MS = 14L * 24 * 3600 * 1000;
  private static final String ID = "[0-9a-f]{32}";

  private final Context context;
  private final SharedPreferences prefs;
  private final SecureRandom random = new SecureRandom();

  JoinClient(Context context) {
    this.context = context.getApplicationContext();
    this.prefs = this.context.getSharedPreferences("totr", Context.MODE_PRIVATE);
  }

  private synchronized JSONArray load() {
    JSONArray kept = new JSONArray();
    try {
      JSONArray raw = new JSONArray(prefs.getString(KEY, "[]"));
      long now = System.currentTimeMillis();
      for (int i = 0; i < raw.length() && kept.length() < MAX_JOINS; i++) {
        JSONObject j = raw.optJSONObject(i);
        if (j != null
            && j.optString("requestId").matches(ID)
            && j.optString("token").length() >= 32
            && AccessList.originOf(j.optString("origin")) != null
            && now - j.optLong("createdAt", 0) < MAX_AGE_MS) kept.put(j);
      }
    } catch (Exception e) {
      /* damaged: start again */
    }
    return kept;
  }

  private synchronized void save(JSONArray list) {
    prefs.edit().putString(KEY, list.toString()).apply();
  }

  private static String forPage(JSONArray list) {
    try {
      JSONArray out = new JSONArray();
      for (int i = 0; i < list.length(); i++) {
        JSONObject j = list.getJSONObject(i); // never the token
        out.put(
            new JSONObject()
                .put("requestId", j.getString("requestId"))
                .put("origin", j.getString("origin"))
                .put("name", Discover.clean(j.optString("name"), 40))
                .put("status", j.optString("status", "pending")));
      }
      return new JSONObject().put("joins", out).toString();
    } catch (Exception e) {
      return error("Could not read the requests.");
    }
  }

  static String error(String message) {
    try {
      return new JSONObject().put("error", message).toString();
    } catch (Exception e) {
      return "{\"error\":\"error\"}";
    }
  }

  /**
   * Asks the server at this address to let the person in. details = {name, note, history:{since,
   * plays, mixtapes, songs}}.
   */
  String ask(String address, String detailsJson, String appVersion) {
    String origin = AccessList.originOf(address);
    if (origin == null)
      return error("Use an https:// address, for example https://totr.example:8443.");
    try {
      JSONObject d =
          new JSONObject(detailsJson == null || detailsJson.isEmpty() ? "{}" : detailsJson);
      JSONArray list = load();
      for (int i = 0; i < list.length(); i++) {
        JSONObject j = list.getJSONObject(i);
        if (origin.equals(j.optString("origin"))
            && "pending".equals(j.optString("status", "pending")))
          return error(
              "You already asked this server. Wait for the answer, or cancel that request first.");
      }
      if (list.length() >= MAX_JOINS) return error("Too many requests are open. Cancel one first.");
      Map<String, Object> history = new LinkedHashMap<>();
      JSONObject h = d.optJSONObject("history");
      if (h != null) {
        if (h.opt("since") instanceof String) history.put("since", h.getString("since"));
        for (String k : new String[] {"plays", "mixtapes", "songs"})
          if (h.opt(k) instanceof Integer) history.put(k, h.getInt(k));
      }
      JoinRequest.Built built =
          JoinRequest.build(
              d.optString("name"),
              d.optString("note"),
              "android",
              appVersion,
              history,
              System.currentTimeMillis(),
              random,
              InstallKey.publicPoint(),
              InstallKey.signer());
      if (built == null) return error("Please give a name.");
      String[] info = call("GET", origin + "/api/join", null);
      if (info[0].startsWith("error")) return error(info[1]);
      if (!new JSONObject(info[1]).optBoolean("open"))
        return error("This server is not taking join requests right now.");
      String[] r = call("POST", origin + "/api/join", built.body);
      if (r[0].startsWith("error")) return error(r[1]);
      String id = new JSONObject(r[1]).optString("request_id");
      if (!id.matches(ID)) return error("The server gave an answer this app does not understand.");
      list.put(
          new JSONObject()
              .put("origin", origin)
              .put("requestId", id)
              .put("token", built.token)
              .put("name", Discover.clean(d.optString("name"), 40))
              .put("status", "pending")
              .put("createdAt", System.currentTimeMillis()));
      save(list);
      return forPage(list);
    } catch (Exception e) {
      return error("That did not work.");
    }
  }

  /** Asks each server with a waiting request for its answer. */
  String refresh() {
    JSONArray list = load();
    try {
      for (int i = 0; i < list.length(); i++) {
        JSONObject j = list.getJSONObject(i);
        if (!"pending".equals(j.optString("status", "pending"))) continue;
        String[] r =
            call("GET", j.getString("origin") + "/api/join/" + j.getString("requestId"), null);
        if (r[0].equals("error404")) {
          j.put("status", "declined");
          continue;
        } // the server forgot it (answered long ago): nothing left to wait for
        if (r[0].startsWith("error")) continue; // unreachable now: ask again next time
        String status = new JSONObject(r[1]).optString("status");
        if (status.equals("approved") || status.equals("declined")) j.put("status", status);
      }
      save(list);
    } catch (Exception e) {
      /* what was read so far is kept */
    }
    return forPage(list);
  }

  /** Withdraws a waiting request (best effort) and forgets it. */
  String cancel(String requestId) {
    JSONArray list = load();
    JSONArray kept = new JSONArray();
    try {
      for (int i = 0; i < list.length(); i++) {
        JSONObject j = list.getJSONObject(i);
        if (!j.getString("requestId").equals(requestId)) {
          kept.put(j);
          continue;
        }
        if ("pending".equals(j.optString("status", "pending")))
          call("POST", j.getString("origin") + "/api/join/" + requestId + "/withdraw", "{}");
      }
      save(kept);
    } catch (Exception e) {
      return error("That did not work.");
    }
    return forPage(kept);
  }

  /** An approved request: forgets it and gives {origin, token} for the invite page, or null. */
  String[] takeApproved(String requestId) {
    JSONArray list = load();
    JSONArray kept = new JSONArray();
    String[] out = null;
    try {
      for (int i = 0; i < list.length(); i++) {
        JSONObject j = list.getJSONObject(i);
        if (j.getString("requestId").equals(requestId) && "approved".equals(j.optString("status")))
          out = new String[] {j.getString("origin"), j.getString("token")};
        else kept.put(j);
      }
      if (out != null) save(kept);
    } catch (Exception e) {
      return null;
    }
    return out;
  }

  /**
   * { "ok" | "error" | "error404", body or message }. Certificates: the system's, or the authority
   * pinned for that server (PinnedTls).
   */
  private String[] call(String method, String url, String body) {
    HttpURLConnection c = null;
    try {
      c = PinnedTls.open(url, PinStore.get(context));
      c.setRequestMethod(method);
      c.setInstanceFollowRedirects(false);
      c.setConnectTimeout(8000);
      c.setReadTimeout(15000);
      if (body != null) {
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = c.getOutputStream()) {
          out.write(body.getBytes(StandardCharsets.UTF_8));
        }
      }
      int code = c.getResponseCode();
      String text = read(code >= 400 ? c.getErrorStream() : c.getInputStream());
      if (code == 200) return new String[] {"ok", text};
      String detail = "";
      try {
        detail = new JSONObject(text).optString("detail");
      } catch (Exception e) {
        /* not JSON */
      }
      if (detail.isEmpty())
        detail =
            code == 404
                ? "That server does not take join requests (it may be an older version)."
                : "The server did not accept the request.";
      return new String[] {code == 404 ? "error404" : "error", detail};
    } catch (javax.net.ssl.SSLException e) {
      return new String[] {
        "error",
        "This phone does not trust that server's certificate. A server run by someone else needs"
            + " the invite link from its admin."
      };
    } catch (Exception e) {
      return new String[] {
        "error", "The server could not be reached. Check the network and that the server is on."
      };
    } finally {
      if (c != null) c.disconnect();
    }
  }

  private static String read(InputStream in) throws Exception {
    if (in == null) return "";
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[2048];
    int n;
    while ((n = in.read(buf)) > 0) {
      out.write(buf, 0, n);
      if (out.size() > 20000) break;
    } // answers are tiny; a flood is cut off
    in.close();
    return new String(out.toByteArray(), StandardCharsets.UTF_8);
  }
}
