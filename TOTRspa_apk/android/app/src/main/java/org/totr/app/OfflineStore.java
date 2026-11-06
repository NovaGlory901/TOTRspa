package org.totr.app;

import android.content.Context;
import android.webkit.CookieManager;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Mixtapes saved on the phone for offline mode: the songs and covers are downloaded into the app's
 * private storage (files/offline/) and listed in index.json. The offline player
 * (android-launcher/offline.html) reads that list and plays the files from
 * https://localhost/_offline/<name>, which GuardClient answers from here (with proper byte ranges,
 * so seeking works). Nothing here is reachable from a web server's page.
 */
final class OfflineStore {
  /** Progress for the page: one JSON line each time something changes. */
  interface Progress {
    void say(String json);
  }

  static volatile Progress progress;

  private final Context context;
  private final File dir;
  private final File indexFile;
  private volatile boolean busy;

  OfflineStore(Context context) {
    this.context = context.getApplicationContext();
    dir = new File(context.getFilesDir(), "offline");
    dir.mkdirs();
    indexFile = new File(dir, "index.json");
  }

  /**
   * A connection that also accepts the authority the person pinned for that server (a friend's), so
   * saving and sending work there too.
   */
  private HttpURLConnection open(String address) throws IOException {
    try {
      return PinnedTls.open(address, PinStore.get(context));
    } catch (IOException e) {
      throw e;
    } catch (Exception e) {
      throw new IOException(e);
    }
  }

  synchronized String index() {
    try (InputStream in = new FileInputStream(indexFile)) {
      return new String(readAll(in), "UTF-8");
    } catch (IOException e) {
      return "{\"mixtapes\":[]}";
    }
  }

  private synchronized void writeIndex(JSONObject root) throws IOException {
    File part = new File(dir, "index.json.part");
    try (OutputStream out = new FileOutputStream(part)) {
      out.write(root.toString().getBytes("UTF-8"));
    }
    if (!part.renameTo(indexFile)) throw new IOException("could not write the list");
  }

  private JSONObject readIndex() {
    try {
      return new JSONObject(index());
    } catch (Exception e) {
      return newIndex();
    }
  }

  private static JSONObject newIndex() {
    try {
      return new JSONObject().put("mixtapes", new JSONArray());
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  long bytes() {
    long total = 0;
    File[] files = dir.listFiles();
    if (files != null) for (File f : files) total += f.length();
    return total;
  }

  private static void say(String stage, String name, int done, int total, String message) {
    Progress p = progress;
    if (p == null) return;
    try {
      p.say(
          new JSONObject()
              .put("stage", stage)
              .put("name", name)
              .put("done", done)
              .put("total", total)
              .put("message", message == null ? "" : message)
              .toString());
    } catch (Exception ignored) {
      /* nothing to say */
    }
  }

  /**
   * json: {id, name, origin, tracks: [{track_id, title, artists, album_id}]}. Runs in the
   * background; progress comes through `progress`.
   */
  void save(final String json) {
    if (busy) {
      say("error", "", 0, 0, "another mixtape is still being saved");
      return;
    }
    busy = true;
    new Thread(
            () -> {
              String name = "";
              try {
                JSONObject req = new JSONObject(json);
                name = req.optString("name");
                String origin = req.getString("origin");
                if (!(origin.startsWith("http://") || origin.startsWith("https://"))
                    || origin.indexOf('/', 8) >= 0) throw new Exception("bad server address");
                String cookie = CookieManager.getInstance().getCookie(origin);
                JSONArray in = req.getJSONArray("tracks"), tracks = new JSONArray();
                int total = in.length();
                say("saving", name, 0, total, "");
                for (int i = 0; i < total; i++) {
                  JSONObject t = in.getJSONObject(i);
                  long id = t.getLong("track_id");
                  String audio =
                      download(origin + "/api/tracks/" + id + "/audio", "t" + id, cookie, true);
                  String cover = "";
                  if (!t.isNull("album_id")) {
                    long album = t.getLong("album_id");
                    try {
                      cover =
                          download(
                              origin + "/api/albums/" + album + "/cover",
                              "c" + album,
                              cookie,
                              false);
                    } catch (IOException noCover) {
                      cover = "";
                    }
                  }
                  tracks.put(
                      new JSONObject()
                          .put("id", id)
                          .put("title", t.optString("title"))
                          .put("artists", t.optString("artists"))
                          .put("file", audio)
                          .put("cover", cover));
                  say("saving", name, i + 1, total, "");
                }
                JSONObject root = readIndex();
                JSONArray list = root.getJSONArray("mixtapes"), kept = new JSONArray();
                for (int i = 0; i < list.length(); i++)
                  if (!list.getJSONObject(i).optString("id").equals(req.optString("id")))
                    kept.put(list.getJSONObject(i));
                kept.put(
                    new JSONObject()
                        .put("id", req.optString("id"))
                        .put("name", name)
                        .put("savedAt", System.currentTimeMillis())
                        .put("tracks", tracks));
                root.put("mixtapes", kept);
                writeIndex(root);
                sweep(root);
                say("done", name, total, total, "");
              } catch (Exception e) {
                say("error", name, 0, 0, e.getClass().getSimpleName() + ": " + e.getMessage());
              } finally {
                busy = false;
              }
            },
            "totr-offline")
        .start();
  }

  /**
   * Downloads one file into a temporary name, then renames it. Returns the file name (with the
   * extension its type calls for).
   */
  private String download(String address, String stem, String cookie, boolean audio)
      throws IOException {
    // already here? (the same song in two mixtapes, or saving again)
    File[] have = dir.listFiles((d, n) -> n.startsWith(stem + ".") && !n.endsWith(".part"));
    if (have != null && have.length > 0) return have[0].getName();
    HttpURLConnection c = open(address);
    c.setConnectTimeout(10000);
    c.setReadTimeout(30000);
    if (cookie != null) c.setRequestProperty("Cookie", cookie);
    try {
      if (c.getResponseCode() != 200)
        throw new IOException("the server answered " + c.getResponseCode() + " for " + stem);
      String type = c.getContentType() == null ? "" : c.getContentType().toLowerCase();
      String name = stem + "." + extension(type, audio);
      File part = new File(dir, name + ".part");
      try (InputStream in = c.getInputStream();
          OutputStream out = new FileOutputStream(part)) {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
      }
      if (!part.renameTo(new File(dir, name))) throw new IOException("could not store " + name);
      return name;
    } finally {
      c.disconnect();
    }
  }

  private static String extension(String type, boolean audio) {
    if (type.contains("mpeg") || type.contains("mp3")) return "mp3";
    if (type.contains("flac")) return "flac";
    if (type.contains("opus")) return "opus";
    if (type.contains("ogg")) return "ogg";
    if (type.contains("mp4") || type.contains("aac") || type.contains("m4a")) return "m4a";
    if (type.contains("wav")) return "wav";
    if (type.contains("png")) return "png";
    if (type.contains("webp")) return "webp";
    if (type.contains("gif")) return "gif";
    if (type.contains("svg")) return "svg";
    return audio ? "mp3" : "jpg";
  }

  // offering saved songs to a server

  /**
   * What the page may offer: every saved song once, with the size and SHA-256 the server will check
   * the file against. Done on a thread (hashing takes a moment); result through `done`.
   */
  void listSongs(final java.util.function.Consumer<String> done) {
    new Thread(
            () -> {
              JSONArray out = new JSONArray();
              try {
                JSONArray list = readIndex().getJSONArray("mixtapes");
                Set<String> seen = new HashSet<>();
                for (int i = 0; i < list.length(); i++) {
                  JSONArray tracks = list.getJSONObject(i).getJSONArray("tracks");
                  for (int j = 0; j < tracks.length(); j++) {
                    JSONObject t = tracks.getJSONObject(j);
                    String name = t.optString("file");
                    File f = file(name);
                    int dot = name.lastIndexOf('.');
                    if (f == null || dot < 0 || !seen.add(name)) continue;
                    String ext = name.substring(dot).toLowerCase();
                    if (!ext.matches("\\.(mp3|flac|ogg|opus|m4a|wav)")
                        || f.length() < 1
                        || f.length() > 300L * 1024 * 1024) continue;
                    out.put(
                        new JSONObject()
                            .put("file", name)
                            .put("title", t.optString("title"))
                            .put("artist", t.optString("artists"))
                            .put("album", "")
                            .put("ext", ext)
                            .put("size", f.length())
                            .put("sha256", sha256(f)));
                  }
                }
              } catch (Exception ignored) {
                /* an unreadable list offers nothing */
              }
              done.accept(out.toString());
            },
            "totr-songs")
        .start();
  }

  private static String sha256(File f) throws Exception {
    java.security.MessageDigest d = java.security.MessageDigest.getInstance("SHA-256");
    try (InputStream in = new FileInputStream(f)) {
      byte[] buf = new byte[65536];
      int n;
      while ((n = in.read(buf)) > 0) d.update(buf, 0, n);
    }
    StringBuilder sb = new StringBuilder();
    for (byte b : d.digest()) sb.append(String.format("%02x", b));
    return sb.toString();
  }

  /**
   * Sends one accepted song to the server it was offered to (PUT of the raw bytes, with this app's
   * sign-in cookie and the page's CSRF token). Result through `done` as JSON {ok, message}.
   */
  void sendSong(
      final String origin,
      final String offerId,
      final int itemNo,
      final String name,
      final String csrf,
      final java.util.function.Consumer<String> done) {
    new Thread(
            () -> {
              String message = "";
              boolean ok = false;
              try {
                File f = file(name);
                if (f == null) throw new IOException("that song is no longer saved on this phone");
                if (!(origin.startsWith("http://") || origin.startsWith("https://"))
                    || origin.indexOf('/', 8) >= 0) throw new IOException("bad server address");
                if (!offerId.matches("[0-9a-f]{32}")) throw new IOException("bad offer");
                HttpURLConnection c =
                    open(origin + "/api/songs/offers/" + offerId + "/items/" + itemNo);
                c.setRequestMethod("PUT");
                c.setDoOutput(true);
                c.setConnectTimeout(10000);
                c.setReadTimeout(60000);
                c.setFixedLengthStreamingMode(f.length());
                c.setRequestProperty("Content-Type", "application/octet-stream");
                String cookie = CookieManager.getInstance().getCookie(origin);
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
                if (csrf != null) c.setRequestProperty("X-CSRF-Token", csrf);
                try (InputStream in = new FileInputStream(f);
                    OutputStream out = c.getOutputStream()) {
                  byte[] buf = new byte[65536];
                  int n;
                  while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                int code = c.getResponseCode();
                ok = code == 200;
                if (!ok) {
                  try (InputStream err = c.getErrorStream()) {
                    message =
                        err == null
                            ? "the server answered " + code
                            : new JSONObject(new String(readAll(err), "UTF-8"))
                                .optString("detail", "the server answered " + code);
                  }
                }
                c.disconnect();
              } catch (Exception e) {
                message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
              }
              try {
                done.accept(
                    new JSONObject()
                        .put("ok", ok)
                        .put("message", message)
                        .put("offerId", offerId)
                        .put("itemNo", itemNo)
                        .toString());
              } catch (Exception ignored) {
                /* page gone */
              }
            },
            "totr-send")
        .start();
  }

  void remove(String id) {
    try {
      JSONObject root = readIndex();
      JSONArray list = root.getJSONArray("mixtapes"), kept = new JSONArray();
      for (int i = 0; i < list.length(); i++)
        if (!list.getJSONObject(i).optString("id").equals(id)) kept.put(list.getJSONObject(i));
      root.put("mixtapes", kept);
      writeIndex(root);
      sweep(root);
    } catch (Exception ignored) {
      /* nothing to remove */
    }
  }

  /** Deletes files no saved mixtape refers to any more (and half-finished downloads). */
  private void sweep(JSONObject root) {
    Set<String> used = new HashSet<>();
    used.add("index.json");
    try {
      JSONArray list = root.getJSONArray("mixtapes");
      for (int i = 0; i < list.length(); i++) {
        JSONArray t = list.getJSONObject(i).getJSONArray("tracks");
        for (int j = 0; j < t.length(); j++) {
          used.add(t.getJSONObject(j).optString("file"));
          used.add(t.getJSONObject(j).optString("cover"));
        }
      }
    } catch (Exception e) {
      return;
    }
    File[] files = dir.listFiles();
    if (files != null) for (File f : files) if (!used.contains(f.getName())) f.delete();
  }

  File file(String name) {
    if (name == null || !name.matches("[A-Za-z0-9_.-]{1,80}") || name.startsWith(".")) return null;
    File f = new File(dir, name);
    return f.isFile() ? f : null;
  }

  /** The file, with HTTP byte ranges (a plain stream would make seeking play the wrong part). */
  WebResourceResponse serve(String name, Map<String, String> requestHeaders) {
    File f = file(name);
    if (f == null)
      return new WebResourceResponse(
          "text/plain",
          "utf-8",
          404,
          "Not Found",
          new HashMap<>(),
          new ByteArrayInputStream(new byte[0]));
    long size = f.length(), from = 0, to = size - 1;
    boolean partial = false;
    String range =
        requestHeaders.get("Range") != null
            ? requestHeaders.get("Range")
            : requestHeaders.get("range");
    try {
      if (range != null && range.startsWith("bytes=")) {
        String[] p = range.substring(6).split("-", 2);
        if (!p[0].isEmpty()) {
          from = Long.parseLong(p[0]);
          if (p.length > 1 && !p[1].isEmpty()) to = Math.min(to, Long.parseLong(p[1]));
        } else if (p.length > 1 && !p[1].isEmpty()) {
          from = Math.max(0, size - Long.parseLong(p[1]));
        }
        if (from > to || from >= size)
          return new WebResourceResponse(
              "text/plain",
              "utf-8",
              416,
              "Range Not Satisfiable",
              new HashMap<>(),
              new ByteArrayInputStream(new byte[0]));
        partial = true;
      }
      FileInputStream in = new FileInputStream(f);
      if (from > 0) in.skip(from);
      Map<String, String> h = new HashMap<>();
      h.put("Accept-Ranges", "bytes");
      h.put("Content-Length", String.valueOf(to - from + 1));
      if (partial) h.put("Content-Range", "bytes " + from + "-" + to + "/" + size);
      return new WebResourceResponse(
          mime(name),
          null,
          partial ? 206 : 200,
          partial ? "Partial Content" : "OK",
          h,
          limit(in, to - from + 1));
    } catch (Exception e) {
      return new WebResourceResponse(
          "text/plain",
          "utf-8",
          500,
          "Error",
          new HashMap<>(),
          new ByteArrayInputStream(new byte[0]));
    }
  }

  private static InputStream limit(final InputStream in, final long max) {
    return new InputStream() {
      long left = max;

      @Override
      public int read() throws IOException {
        if (left <= 0) return -1;
        int b = in.read();
        if (b >= 0) left--;
        return b;
      }

      @Override
      public int read(byte[] b, int off, int len) throws IOException {
        if (left <= 0) return -1;
        int n = in.read(b, off, (int) Math.min(len, left));
        if (n > 0) left -= n;
        return n;
      }

      @Override
      public int available() {
        return (int) Math.min(left, Integer.MAX_VALUE);
      }

      @Override
      public void close() throws IOException {
        in.close();
      }
    };
  }

  private static String mime(String name) {
    String n = name.toLowerCase();
    if (n.endsWith(".mp3")) return "audio/mpeg";
    if (n.endsWith(".flac")) return "audio/flac";
    if (n.endsWith(".ogg") || n.endsWith(".opus")) return "audio/ogg";
    if (n.endsWith(".m4a")) return "audio/mp4";
    if (n.endsWith(".wav")) return "audio/wav";
    if (n.endsWith(".png")) return "image/png";
    if (n.endsWith(".webp")) return "image/webp";
    if (n.endsWith(".gif")) return "image/gif";
    if (n.endsWith(".svg")) return "image/svg+xml";
    if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
    return "application/octet-stream";
  }

  private static byte[] readAll(InputStream in) throws IOException {
    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    int n;
    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    return out.toByteArray();
  }
}
