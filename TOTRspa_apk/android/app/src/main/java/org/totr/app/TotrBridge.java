package org.totr.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import java.net.HttpURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What the page can ask of the phone: `window.TotrNative`. Mostly it keeps the music playing in the
 * background and shows the lock-screen controls. It is added to the WebView by MainActivity; the
 * page only ever comes from a TOTR server (navigation is limited to local-network hosts in
 * capacitor.config.json). Text arrives as plain strings and is shown with setContentTitle, never
 * parsed.
 *
 * <p>The page may be a friend's server, so the calls that reach beyond playing (the server list,
 * probing addresses, offering saved songs, installing an update) only work for a server the person
 * allowed (AccessList, `allowed()` below). The phone asks once per server; the question is the
 * phone's own and a page cannot press it. Which server is asking comes from the WebView's real
 * address, never from anything the page sends. Playing, the lock screen, offline mode and the saved
 * mixtapes need no permission.
 */
public class TotrBridge {
  private final Context context;
  private final Activity
      activity; // for the questions only the phone can ask (a page cannot press these buttons)
  private final java.util.Set<String> sendApproved = new java.util.HashSet<>();

  private final Updater updater;
  private final WebView web;
  private final OfflineStore store;
  private final SharedPreferences prefs;
  private static final String HOME = "https://localhost/index.html",
      OFFLINE_PAGE = "https://localhost/offline.html";
  private static final String ACCESS_KEY = "access";
  private final NearScan near;
  private final JoinClient joins;
  private final AccountStore accounts;
  private final java.util.Set<String> saveAsked =
      new java.util.HashSet<>(); // one 'save this sign-in?' question per server per run
  private final Object accessLock = new Object();
  private final java.util.Set<String> accessRefused =
      new java.util.HashSet<>(); // "Not now" holds until the app is closed and opened again

  TotrBridge(Activity activity, WebView web, OfflineStore store) {
    this.activity = activity;
    this.context = activity.getApplicationContext();
    this.web = web;
    this.store = store;
    this.updater = new Updater(context);
    this.near = new NearScan(context);
    this.joins = new JoinClient(context);
    this.accounts = new AccountStore(context);
    this.prefs = context.getSharedPreferences("totr", Context.MODE_PRIVATE);
    GuardClient.offline = prefs.getBoolean("offline", false);
    // an install from before the controls were per server keeps them for the servers it already
    // knew; anything added later is asked about
    java.util.List<String> known = new java.util.ArrayList<>();
    known.add(prefs.getString("server", ""));
    JSONArray saved = savedList();
    for (int i = 0; i < saved.length(); i++)
      known.add(saved.optJSONObject(i) == null ? "" : saved.optJSONObject(i).optString("origin"));
    String inherited = AccessList.inherit(prefs.getString(ACCESS_KEY, null), known);
    if (inherited != null) prefs.edit().putString(ACCESS_KEY, inherited).apply();
  }

  /**
   * Lets the page know this app has the native audio piece (older installs do not, and the page
   * then does nothing).
   */
  @JavascriptInterface
  public int version() {
    return 1;
  }

  /**
   * The installed app's version (from package.json at build time), so the page can show it and ask
   * for a newer installer.
   */
  @JavascriptInterface
  public String appVersion() {
    try {
      return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
    } catch (Exception e) {
      return "";
    }
  }

  /**
   * Is the app closed up (offline mode)? The launcher page asks this first and opens the offline
   * player instead of looking for the server.
   */
  @JavascriptInterface
  public boolean isOffline() {
    return GuardClient.offline;
  }

  /**
   * Closes the app up: from now on only the app's own pages load, nothing on any network is reached
   * or accepted, until goOnline(). Remembered across launches.
   */
  @JavascriptInterface
  public void goOffline() {
    GuardClient.offline = true;
    prefs.edit().putBoolean("offline", true).apply();
    stop();
    web.post(() -> web.loadUrl(OFFLINE_PAGE));
  }

  /** The person's deliberate switch back: opens the launcher, which looks for the server again. */
  @JavascriptInterface
  public void goOnline() {
    GuardClient.offline = false;
    prefs.edit().putBoolean("offline", false).apply();
    stop();
    web.post(() -> web.loadUrl(HOME));
  }

  // The list lives here (SharedPreferences), not in the page: every server is its own web origin
  // and could not see another one's storage.
  // The launcher page and the You tab both use it. Only https addresses are kept (the app refuses
  // plain http).
  private static final String SERVER_KEY = "server", SERVERS_KEY = "servers";

  /** "https://host[:port]" for what was typed, or null if it is not an https address. */
  private static String originOf(String address) {
    return AccessList.originOf(address);
  }

  private JSONArray savedList() {
    try {
      return new JSONArray(prefs.getString(SERVERS_KEY, "[]"));
    } catch (Exception e) {
      return new JSONArray();
    }
  }

  /**
   * Adds a server to the list; "" when it worked, "exists" when it was already there, otherwise a
   * sentence for the person.
   */
  private String addToList(String name, String origin) {
    try {
      JSONArray list = savedList();
      for (int i = 0; i < list.length(); i++)
        if (origin.equals(list.getJSONObject(i).optString("origin"))) return "exists";
      if (list.length() >= 30) return "The list is full (30 servers). Remove one first.";
      String label = name == null ? "" : name.trim();
      if (label.length() > 40) label = label.substring(0, 40);
      list.put(new JSONObject().put("name", label).put("origin", origin));
      prefs.edit().putString(SERVERS_KEY, list.toString()).apply();
      return "";
    } catch (Exception e) {
      return "Could not save the server.";
    }
  }

  /** {"current":"https://host","list":[{"name":"Home","origin":"https://host"}]}. */
  @JavascriptInterface
  public String servers() {
    if (!allowed(false)) return "{\"current\":\"\",\"list\":[]}";
    try {
      return new JSONObject()
          .put("current", prefs.getString(SERVER_KEY, ""))
          .put("list", savedList())
          .toString();
    } catch (Exception e) {
      return "{\"current\":\"\",\"list\":[]}";
    }
  }

  /** Adds a server to the list; returns "" when it worked, otherwise what to tell the person. */
  @JavascriptInterface
  public String addServer(String name, String address) {
    if (!allowed(false)) return NOT_ALLOWED;
    if (address != null
        && address.contains(
            "#fp=")) { // an invite link (or an address with the server's code): the invite flow
      // below asks the person on the phone's own screen
      if (JoinLink.parse(address) == null)
        return "That invite link is not valid. Copy the whole link again.";
      final String link = address;
      new Thread(() -> acceptLink(link), "totr-invite").start();
      return "";
    }
    String origin = originOf(address);
    if (origin == null) return "Use an https:// address, for example https://totr.example:8443.";
    String r = addToList(name, origin);
    return "exists".equals(r) ? "That server is already in the list." : r;
  }

  /** Takes a server off the list (the one in use stays: the page does not offer it). */
  @JavascriptInterface
  public void removeServer(String address) {
    if (!allowed(false)) return;
    String origin = originOf(address);
    if (origin == null || origin.equals(prefs.getString(SERVER_KEY, ""))) return;
    try {
      JSONArray list = savedList(), kept = new JSONArray();
      for (int i = 0; i < list.length(); i++)
        if (!origin.equals(list.getJSONObject(i).optString("origin"))) kept.put(list.get(i));
      prefs.edit().putString(SERVERS_KEY, kept.toString()).apply();
      accounts.forget(origin); // a server taken off the list takes its saved sign-in with it
    } catch (Exception e) {
      /* the list stays as it was */
    }
  }

  /**
   * The launcher calls this once a server answers: it is the one in use now, and it joins the list
   * if it was not there (an install from before the list).
   */
  @JavascriptInterface
  public void rememberServer(String address) {
    if (!allowed(false)) return;
    String origin = originOf(address);
    if (origin == null) return;
    addToList("", origin);
    prefs.edit().putString(SERVER_KEY, origin).apply();
  }

  /**
   * Switches to a saved server: stops the music and opens the launcher on it
   * (index.html?use=<address>), which looks for it and opens it or shows NO SIGNAL.
   */
  @JavascriptInterface
  public void useServer(String address) {
    if (!allowed(false)) return;
    final String origin = originOf(address);
    if (origin == null) return;
    stop();
    web.post(() -> web.loadUrl(HOME + "?use=" + android.net.Uri.encode(origin)));
  }

  /**
   * Is a TOTR server answering at this address (http://host:port)? Answers asynchronously:
   * window.__totrProbe(address, true|false).
   */
  @JavascriptInterface
  public void probe(final String origin) {
    new Thread(
            () -> {
              boolean ok = false;
              try {
                if (allowed(false)
                    && origin != null
                    && (origin.startsWith("http://") || origin.startsWith("https://"))) {
                  HttpURLConnection c =
                      PinnedTls.open(origin + "/app/version.json", PinStore.get(context));
                  c.setConnectTimeout(3000);
                  c.setReadTimeout(3000);
                  ok = c.getResponseCode() == 200;
                  c.disconnect();
                }
              } catch (Exception e) {
                ok = false;
              }
              final boolean result = ok;
              web.post(
                  () ->
                      web.evaluateJavascript(
                          "window.__totrProbe&&window.__totrProbe("
                              + org.json.JSONObject.quote(origin == null ? "" : origin)
                              + ","
                              + result
                              + ")",
                          null));
            },
            "totr-probe")
        .start();
  }

  // The app remembers a person's username and password for each server (AccountStore, sealed with a
  // key in the key store) and signs in for them. A saved sign-in belongs to ONE
  // server and is only used for a page of that server, which is read from the WebView's real
  // address, never from anything the page sends. The page can ask to save (the
  // phone asks the person in its own dialog, once per server per run, with "Never for this server")
  // and can ask for the saved sign-in to be used; it never receives the
  // password, only a yes or no. Looking at or removing a sign-in for ANOTHER server needs the Allow
  // question like the other controls that reach beyond the page's own server.

  /**
   * op: auto | save | signedOut | suggest | have | forget | list. The answer comes back as
   * window.__totrAccountsDone(id, json).
   */
  @JavascriptInterface
  public void accountCall(final String id, final String op, final String args) {
    if (id == null || !id.matches("\\d{1,9}")) return;
    new Thread(
            () -> {
              String result;
              try {
                result =
                    accountOp(
                        op == null ? "" : op,
                        new JSONObject(args == null || args.length() > 1000 ? "{}" : args));
              } catch (Exception e) {
                result = "{\"ok\":false}";
              }
              final String json = result;
              web.post(
                  () ->
                      web.evaluateJavascript(
                          "window.__totrAccountsDone&&window.__totrAccountsDone("
                              + id
                              + ","
                              + org.json.JSONObject.quote(json)
                              + ")",
                          null));
            },
            "totr-accounts")
        .start();
  }

  private String accountOp(String op, JSONObject a) throws Exception {
    String page = pageOrigin();
    switch (op) {
      case "auto":
        {
          if (page.isEmpty() || AccessList.isOwnPage(page) || GuardClient.offline)
            return "{\"signedIn\":false}";
          return "{\"signedIn\":" + accounts.autoSignIn(page) + "}";
        }
      case "save":
        {
          if (page.isEmpty() || AccessList.isOwnPage(page) || accounts.isNever(page))
            return "{\"ok\":false}";
          String user = a.optString("username"), pass = a.optString("password");
          Vault.Entry have = accounts.get(page);
          if (have
              == null) { // the first time for this server: the person decides, on the phone's own
            // screen
            synchronized (saveAsked) {
              if (!saveAsked.add(page)) return "{\"ok\":false}";
            }
            int answer =
                ask3(
                    "Save this sign-in?",
                    "Let this app remember your sign-in for "
                        + page.substring("https://".length())
                        + " and sign you in there itself next time? It is kept in the phone's"
                        + " protected storage and only used for that server.",
                    "Save",
                    "Not now",
                    "Never for this server");
            if (answer == 2) {
              accounts.never(page);
              return "{\"ok\":false}";
            }
            if (answer != 0) return "{\"ok\":false}";
          }
          return "{\"ok\":" + accounts.put(page, user, pass) + "}";
        }
      case "signedOut":
        if (!page.isEmpty() && !AccessList.isOwnPage(page)) accounts.signedOut(page);
        return "{\"ok\":true}";
      case "suggest":
        return new JSONObject()
            .put("password", Vault.newPassword(new java.security.SecureRandom()))
            .toString();
      case "have":
        {
          if (!allowed(false)) return JoinClient.error(NOT_ALLOWED);
          Vault.Entry e = accounts.get(AccessList.originOf(a.optString("origin")));
          return e == null
              ? "{\"have\":false}"
              : new JSONObject().put("have", true).put("username", e.username).toString();
        }
      case "forget":
        {
          if (!allowed(false)) return JoinClient.error(NOT_ALLOWED);
          String origin = AccessList.originOf(a.optString("origin"));
          if (origin != null) accounts.forget(origin);
          return "{\"ok\":true}";
        }
      case "list":
        {
          if (!allowed(false)) return JoinClient.error(NOT_ALLOWED);
          org.json.JSONArray arr = new org.json.JSONArray();
          for (String o : savedOrigins()) {
            Vault.Entry e = accounts.get(o);
            if (e != null) arr.put(new JSONObject().put("origin", o).put("username", e.username));
          }
          return new JSONObject().put("accounts", arr).toString();
        }
      default:
        return "{\"ok\":false}";
    }
  }

  private java.util.List<String> savedOrigins() {
    java.util.List<String> out = new java.util.ArrayList<>();
    JSONArray list = savedList();
    for (int i = 0; i < list.length(); i++) {
      JSONObject j = list.optJSONObject(i);
      if (j != null) out.add(j.optString("origin"));
    }
    return out;
  }

  /**
   * A question with three buttons on the phone's own screen: 0 = the first, 1 = the second, 2 = the
   * third. No answer in two minutes counts as the second. Not on the main thread.
   */
  private int ask3(
      final String title,
      final String message,
      final String first,
      final String second,
      final String third) {
    final int[] answer = {1};
    final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
    activity.runOnUiThread(
        () -> {
          try {
            new android.app.AlertDialog.Builder(activity)
                .setTitle(title)
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton(
                    first,
                    (d, w) -> {
                      answer[0] = 0;
                      done.countDown();
                    })
                .setNegativeButton(
                    second,
                    (d, w) -> {
                      answer[0] = 1;
                      done.countDown();
                    })
                .setNeutralButton(
                    third,
                    (d, w) -> {
                      answer[0] = 2;
                      done.countDown();
                    })
                .show();
          } catch (Exception e) {
            done.countDown();
          }
        });
    try {
      done.await(120, java.util.concurrent.TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    return answer[0];
  }

  // The admin's invite link carries the fingerprint of the server's own certificate authority after
  // a "#". The phone fetches that authority from the server, trusts it only if it
  // hashes to the fingerprint in the link, and asks the person (the phone's own dialog, naming the
  // server) before remembering it FOR THAT SERVER ONLY. Then the invite page opens.

  private void tell(final String message) {
    activity.runOnUiThread(
        () ->
            android.widget.Toast.makeText(activity, message, android.widget.Toast.LENGTH_LONG)
                .show());
  }

  /**
   * Takes an invite link (from a tapped link or the add-server box). Must not be called on the main
   * thread.
   */
  void acceptLink(String link) {
    JoinLink j = JoinLink.parse(link);
    if (j == null) {
      tell("That is not a TOTR invite link.");
      return;
    }
    if (GuardClient.offline) {
      tell("The app is in offline mode. Switch it online first.");
      return;
    }
    long now = System.currentTimeMillis();
    String stored = PinStore.get(context);
    java.security.cert.X509Certificate have = Pins.authorityFor(stored, j.origin, now);
    if (have == null || !Pins.matches(have, j.code)) {
      java.security.cert.X509Certificate found = Pins.parse(PinnedTls.fetchAuthority(j.origin));
      if (found == null || !Pins.usableAuthority(found, now) || !Pins.matches(found, j.code)) {
        tell(
            "This server's certificate does not match the invite, or the server did not answer."
                + " Nothing was added.");
        return;
      }
      String host = j.origin.substring("https://".length());
      if (!ask(
          "Add this server?",
          host
              + " sent an invite with a code for its certificate authority ("
              + j.code
              + "), and the server's own authority matches it.\n\n"
              + "If you add it, this app trusts that authority for "
              + host
              + " only, and nothing else on your phone changes. Only add a server of someone you"
              + " know.",
          "Add",
          "Cancel")) return;
      String next = Pins.add(stored, j.origin, found, j.code, now);
      if (next == null) {
        tell(
            "Could not remember this server (too many trusted servers, or its certificate is out of"
                + " date).");
        return;
      }
      PinStore.set(context, next);
    }
    addToList("", j.origin);
    prefs.edit().putString(SERVER_KEY, j.origin).apply();
    stop();
    Vault.Entry saved = accounts.get(j.origin);
    boolean useSaved =
        saved != null
            && !j.token.isEmpty()
            && ask(
                "You already have an account there",
                "This app has a saved sign-in for "
                    + j.origin.substring("https://".length())
                    + " ("
                    + saved.username
                    + "). Use it instead of making a new account with this invite?",
                "Use my account",
                "Use the invite");
    final String target =
        j.token.isEmpty() || useSaved
            ? HOME + "?use=" + android.net.Uri.encode(j.origin)
            : j.origin + "/invite/" + j.token;
    web.post(() -> web.loadUrl(target));
  }

  // servers near you, and asking to join
  // The same calls the desktop shell has (window.totrShell.discover / .join), as one bridge call
  // with an id: the answer comes back as window.__totrNearDone(id, json), so the page
  // never waits on the network. All of it needs the Allow question for the page's server, like the
  // other controls that reach beyond playing. A server this phone does not
  // yet trust can be found but not asked: asking needs the system's trust or the authority pinned
  // from that server's invite link.

  /** op: start | list | stop | ask | refresh | cancel | finish. args is a JSON object text. */
  @JavascriptInterface
  public void nearCall(final String id, final String op, final String args) {
    if (id == null || !id.matches("\\d{1,9}")) return;
    new Thread(
            () -> {
              String result;
              try {
                if (!allowed(!AccessList.mayAsk(op)))
                  result =
                      JoinClient.error(
                          NOT_ALLOWED); // the page's timers never raise the Allow question
                // (AccessList.mayAsk)
                else
                  result =
                      nearOp(
                          op == null ? "" : op, args == null || args.length() > 4000 ? "{}" : args);
              } catch (Exception e) {
                result = JoinClient.error("That did not work.");
              }
              final String json = result;
              web.post(
                  () ->
                      web.evaluateJavascript(
                          "window.__totrNearDone&&window.__totrNearDone("
                              + id
                              + ","
                              + org.json.JSONObject.quote(json)
                              + ")",
                          null));
            },
            "totr-near")
        .start();
  }

  private String nearOp(String op, String args) throws Exception {
    JSONObject a = new JSONObject(args);
    switch (op) {
      case "start":
        {
          String e = near.start();
          return e.isEmpty() ? "{\"ok\":true}" : JoinClient.error(e);
        }
      case "list":
        return near.listJson();
      case "stop":
        near.stop();
        return "{\"ok\":true}";
      case "ask":
        {
          Vault.Entry have = accounts.get(AccessList.originOf(a.optString("address")));
          if (have != null)
            return JoinClient.error(
                "You already have an account there ("
                    + have.username
                    + "). Pick that server in the list above and press Switch: the app signs you"
                    + " in.");
          return joins.ask(a.optString("address"), a.optString("details", "{}"), appVersion());
        }
      case "refresh":
        return joins.refresh();
      case "cancel":
        return joins.cancel(a.optString("id"));
      case "finish":
        {
          String[] t = joins.takeApproved(a.optString("id"));
          if (t == null) return JoinClient.error("That request has not been approved.");
          addToList("", t[0]);
          prefs.edit().putString(SERVER_KEY, t[0]).apply();
          stop();
          final String target = t[0] + "/invite/" + t[1];
          web.post(() -> web.loadUrl(target));
          return "{\"ok\":true}";
        }
      default:
        return JoinClient.error("Unknown request.");
    }
  }

  /** Called when the app closes: the network search stops and its Wi-Fi lock is released. */
  void close() {
    near.stop();
  }

  /**
   * Saves a mixtape for offline: json = {id, name, origin,
   * tracks:[{track_id,title,artists,album_id}]}. Progress: window.__totrOffline(json).
   */
  @JavascriptInterface
  public void saveMixtape(String json) {
    store.save(json);
  }

  @JavascriptInterface
  public void removeMixtape(String id) {
    store.remove(id == null ? "" : id);
  }

  /**
   * {"mixtapes":[{id,name,savedAt,tracks:[{id,title,artists,file,cover}]}]}; files play from
   * https://localhost/_offline/<file>.
   */
  @JavascriptInterface
  public String offlineIndex() {
    return store.index();
  }

  @JavascriptInterface
  public double offlineBytes() {
    return store.bytes();
  }

  // The page that asks is a page of whichever server the app is on, and that may be a friend's
  // server. So the phone itself asks the person before it shows the list of
  // saved songs, and before it sends any of them anywhere, and it only sends to the server whose
  // page is open. The dialogs are the phone's own: a page cannot press them.

  /**
   * The address (https://host[:port]) of the page now open, or "". WebView calls must run on the
   * main thread.
   */
  private String pageOrigin() {
    final String[] out = {""};
    final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
    activity.runOnUiThread(
        () -> {
          try {
            out[0] = originOf(web.getUrl());
            if (out[0] == null) out[0] = "";
          } finally {
            done.countDown();
          }
        });
    try {
      done.await(5, java.util.concurrent.TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    return out[0];
  }

  private boolean ask(final String title, final String message) {
    return ask(title, message, "Yes", "No");
  }

  /**
   * A question on the phone's own screen. No answer in two minutes counts as no. Must not be called
   * on the main thread.
   */
  private boolean ask(
      final String title, final String message, final String yesLabel, final String noLabel) {
    final boolean[] yes = {false};
    final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
    activity.runOnUiThread(
        () -> {
          try {
            new android.app.AlertDialog.Builder(activity)
                .setTitle(title)
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton(
                    yesLabel,
                    (d, w) -> {
                      yes[0] = true;
                      done.countDown();
                    })
                .setNegativeButton(noLabel, (d, w) -> done.countDown())
                .show();
          } catch (Exception e) {
            done.countDown();
          }
        });
    try {
      done.await(120, java.util.concurrent.TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    return yes[0];
  }

  // who may use the phone's controls
  private static final String NOT_ALLOWED = "This server is not allowed to use the app's controls.";

  /**
   * May the page now open use the controls that reach beyond playing? The app's own pages always
   * may. A server's page may when its address is on the allowed list (AccessList); if it is not,
   * the person is asked once, on the phone's own screen. "Not now" holds until the app is opened
   * again and is not asked again meanwhile. `quiet` never asks (for a question the page only wants
   * answered, not acted on). Must not be called on the main thread (the bridge's calls are not).
   */
  private boolean allowed(boolean quiet) {
    final String origin = pageOrigin();
    if (origin.isEmpty()) return false;
    if (AccessList.isOwnPage(origin)) return true;
    synchronized (
        accessLock) { // one question at a time; a second call waits and then sees the answer
      if (AccessList.has(prefs.getString(ACCESS_KEY, null), origin)) return true;
      if (quiet || accessRefused.contains(origin)) return false;
      boolean yes =
          ask(
              "Let this server use the app's controls?",
              origin.substring("https://".length())
                  + " wants to use this app's controls. That lets its pages switch which server"
                  + " this app uses, look at addresses on your network, offer songs saved on this"
                  + " phone, and install app updates. Listening to music does not need any of it."
                  + " Only allow a server you trust.",
              "Allow",
              "Not now");
      if (!yes) {
        accessRefused.add(origin);
        return false;
      }
      prefs
          .edit()
          .putString(ACCESS_KEY, AccessList.grant(prefs.getString(ACCESS_KEY, null), origin))
          .apply(); // if it cannot be saved it is asked again next time
      return true;
    }
  }

  /**
   * Saved songs the person could offer to a server: window.__totrSongs(json) gets [{file, title,
   * artist, album, ext, size, sha256}], or [] if the person says no.
   */
  @JavascriptInterface
  public void listSavedSongs() {
    new Thread(
            () -> {
              String host = pageOrigin();
              if (host.isEmpty()
                  || !allowed(false)
                  || !ask(
                      "Show your saved songs?",
                      host
                          + " wants to see which songs are saved on this phone (titles and"
                          + " artists), so you can offer some of them. Allow it?")) {
                web.post(
                    () ->
                        web.evaluateJavascript("window.__totrSongs&&window.__totrSongs([])", null));
                return;
              }
              store.listSongs(
                  json ->
                      web.post(
                          () ->
                              web.evaluateJavascript(
                                  "window.__totrSongs&&window.__totrSongs(" + json + ")", null)));
            },
            "totr-songs-ask")
        .start();
  }

  /**
   * Sends one accepted song: window.__totrSent({ok, message, offerId, itemNo}). Only to the server
   * whose page is open, and only after the person agreed to send for that offer.
   */
  @JavascriptInterface
  public void sendSavedSong(
      final String origin,
      final String offerId,
      final int itemNo,
      final String file,
      final String csrf) {
    new Thread(
            () -> {
              String host = pageOrigin(), id = offerId == null ? "" : offerId;
              String refusal = null;
              if (host.isEmpty() || !host.equals(origin))
                refusal = "Songs can only be sent to the server this page belongs to.";
              else if (!allowed(false)) refusal = NOT_ALLOWED;
              else if (!sendApproved.contains(host + "|" + id)
                  && !ask(
                      "Send songs from this phone?",
                      "Send the songs you offered from this phone to "
                          + host
                          + "? Only the ones someone there accepted are sent."))
                refusal = "You said no, so nothing was sent.";
              if (refusal != null) {
                final String msg = org.json.JSONObject.quote(refusal);
                web.post(
                    () ->
                        web.evaluateJavascript(
                            "window.__totrSent&&window.__totrSent({ok:false,message:"
                                + msg
                                + ",offerId:"
                                + org.json.JSONObject.quote(id)
                                + ",itemNo:"
                                + itemNo
                                + "})",
                            null));
                return;
              }
              sendApproved.add(host + "|" + id);
              store.sendSong(
                  origin,
                  id,
                  itemNo,
                  file == null ? "" : file,
                  csrf,
                  json ->
                      web.post(
                          () ->
                              web.evaluateJavascript(
                                  "window.__totrSent&&window.__totrSent(" + json + ")", null)));
            },
            "totr-send-ask")
        .start();
  }

  /**
   * The app's colours, so the pages bundled in the app (which cannot read the server's settings)
   * look like the rest.
   */
  @JavascriptInterface
  public void saveTheme(String json) {
    if (json != null && json.length() < 4096) prefs.edit().putString("theme", json).apply();
  }

  @JavascriptInterface
  public String theme() {
    return prefs.getString("theme", "");
  }

  /** The cover of the song now playing, for the lock screen and notification. */
  @JavascriptInterface
  public void setCover(String address) {
    PlaybackService.setCover(address);
  }

  /** Is TOTR allowed to install apps (Android's "install unknown apps" switch)? */
  @JavascriptInterface
  public boolean canInstall() {
    return allowed(true) && updater.canInstall();
  }

  /** Opens that switch for TOTR. */
  @JavascriptInterface
  public void allowInstall() {
    if (allowed(false)) updater.openInstallPermission();
  }

  /**
   * Downloads the APK at this address, checks its SHA-256, and gives it to Android to install over
   * this app. Progress comes back as window.__totrInstall(stage, percent, message).
   */
  @JavascriptInterface
  public void installApk(String address, String sha256, double size) {
    if (!allowed(false)) {
      web.post(
          () ->
              web.evaluateJavascript(
                  "window.__totrInstall&&window.__totrInstall('error',0,"
                      + org.json.JSONObject.quote(NOT_ALLOWED)
                      + ")",
                  null));
      return;
    }
    updater.start(address, sha256, (long) Math.max(0, size));
  }

  @JavascriptInterface
  public void update(
      String title, String artist, boolean playing, double positionMs, double durationMs) {
    PlaybackService.State s = PlaybackService.state;
    s.title = clip(title);
    s.artist = clip(artist);
    s.playing = playing;
    s.positionMs = (long) Math.max(0, positionMs);
    s.durationMs = (long) Math.max(0, durationMs);
    PlaybackService running = PlaybackService.instance;
    try {
      if (running != null) {
        running.apply();
        return;
      }
      if (playing)
        ContextCompat.startForegroundService(
            context, new Intent(context, PlaybackService.class)); // the app is open now: allowed
    } catch (RuntimeException e) {
      PlaybackService.lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
    }
  }

  /**
   * One line for the You page: is the service running, may it show notifications, and what went
   * wrong last.
   */
  @JavascriptInterface
  public String status() {
    boolean notes =
        androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled();
    return "service "
        + (PlaybackService.instance != null ? "running" : "not running")
        + ", notifications "
        + (notes ? "allowed" : "BLOCKED (turn them on in the phone's settings for TOTR)")
        + (PlaybackService.lastError.isEmpty() ? "" : ", last error: " + PlaybackService.lastError);
  }

  @JavascriptInterface
  public void stop() {
    context.stopService(new Intent(context, PlaybackService.class));
  }

  private static String clip(String t) {
    return t == null ? "" : (t.length() > 200 ? t.substring(0, 200) : t);
  }
}
