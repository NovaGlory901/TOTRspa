package org.totr.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.CookieManager;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;

/**
 * The sign-ins this phone remembers (Vault), kept sealed in the app's preferences, and the native
 * sign-in that uses them. One place for everything that touches a saved password, so it is easy to
 * check that none of it reaches a page: the page asks, this class answers "signed in" or not, and
 * only a session cookie is handed to the WebView.
 */
final class AccountStore {
  private static final String KEY = "vault";
  private final Context context;
  private final SharedPreferences prefs;
  private final Vault.Crypter crypter = new KeystoreCrypter();
  private Vault vault;

  AccountStore(Context context) {
    this.context = context.getApplicationContext();
    this.prefs = this.context.getSharedPreferences("totr", Context.MODE_PRIVATE);
  }

  private Vault vault() {
    if (vault == null) vault = Vault.open(prefs.getString(KEY, ""), crypter);
    return vault;
  }

  private void save() {
    try {
      prefs.edit().putString(KEY, vault().seal(crypter)).apply();
    } catch (Exception e) {
      /* not kept: nothing is ever stored unsealed */
    }
  }

  synchronized Vault.Entry get(String origin) {
    return vault().get(origin);
  }

  synchronized boolean isNever(String origin) {
    return vault().isNever(origin);
  }

  synchronized boolean put(String origin, String username, String password) {
    boolean ok = vault().put(origin, username, password);
    if (ok) save();
    return ok;
  }

  synchronized void never(String origin) {
    if (vault().markNever(origin)) save();
  }

  synchronized void forget(String origin) {
    vault().forget(origin);
    save();
  }

  synchronized void signedOut(String origin) {
    vault().markSignedOut(origin);
    save();
  }

  /**
   * Signs in to this server with the saved sign-in, if there is one, it is allowed (not signed out
   * by hand, not refused three times, not tried in the last 30 seconds), and puts the session
   * cookie in the WebView. True when the WebView is now signed in. Blocks on the network: call it
   * from a worker thread.
   */
  boolean autoSignIn(String origin) {
    Vault.Entry e;
    synchronized (this) {
      e = vault().nextAutoTry(origin, System.currentTimeMillis());
    }
    if (e == null) return false;
    AccountLogin.Result result = AccountLogin.Result.UNREACHABLE;
    String cookie = null;
    HttpURLConnection c = null;
    try {
      c = PinnedTls.open(origin + "/api/auth/login", PinStore.get(context));
      c.setRequestMethod("POST");
      c.setInstanceFollowRedirects(false);
      c.setConnectTimeout(8000);
      c.setReadTimeout(15000);
      c.setDoOutput(true);
      c.setRequestProperty("Content-Type", "application/json");
      try (OutputStream out = c.getOutputStream()) {
        out.write(AccountLogin.body(e.username, e.password).getBytes(StandardCharsets.UTF_8));
      }
      result = AccountLogin.classify(c.getResponseCode());
      if (result == AccountLogin.Result.OK) {
        cookie = AccountLogin.sessionCookie(c.getHeaderFields().get("Set-Cookie"));
        if (cookie == null)
          result =
              AccountLogin.Result.UNREACHABLE; // answered 200 without a session: not a TOTR sign-in
      }
    } catch (Exception ex) {
      result = AccountLogin.Result.UNREACHABLE;
    } finally {
      if (c != null) c.disconnect();
    }
    synchronized (this) {
      if (result == AccountLogin.Result.OK) vault().succeeded(origin);
      else if (result == AccountLogin.Result.REFUSED) vault().failed(origin);
      save();
    }
    if (result != AccountLogin.Result.OK) return false;
    CookieManager cm = CookieManager.getInstance();
    cm.setCookie(origin + "/", cookie);
    cm.flush();
    return true;
  }
}
