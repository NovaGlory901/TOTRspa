package org.totr.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private TotrBridge totr;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WebView web = getBridge().getWebView();
    OfflineStore store = new OfflineStore(getApplicationContext());
    totr = new TotrBridge(this, web, store);
    web.addJavascriptInterface(totr, "TotrNative");
    getBridge()
        .setWebViewClient(
            new GuardClient(
                getBridge(),
                store)); // offline mode's gatekeeper, and where saved mixtapes are served from
    OfflineStore.progress =
        json ->
            web.post(
                () ->
                    web.evaluateJavascript(
                        "window.__totrOffline&&window.__totrOffline(" + json + ")", null));
    PlaybackService.listener =
        new PlaybackService.Listener() {
          @Override
          public void onAction(String action) {
            run("window.__totrMedia&&window.__totrMedia('" + action + "')");
          } // action is one of our own fixed words

          @Override
          public void onSeek(long ms) {
            run("window.__totrSeek&&window.__totrSeek(" + ms + ")");
          }

          private void run(String js) {
            web.post(() -> web.evaluateJavascript(js, null));
          }
        };
    Updater.reporter =
        (stage, percent, message) ->
            web.post(
                () ->
                    web.evaluateJavascript(
                        "window.__totrInstall&&window.__totrInstall("
                            + org.json.JSONObject.quote(stage)
                            + ","
                            + percent
                            + ","
                            + org.json.JSONObject.quote(message == null ? "" : message)
                            + ")",
                        null));
    takeLink(getIntent());
    if (Build.VERSION.SDK_INT >= 33
        && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(
          this,
          new String[] {Manifest.permission.POST_NOTIFICATIONS},
          1); // without it the controls do not show (the music still plays)
    }
  }

  /**
   * A tapped invite link (https://.../invite/... or totr://...): the bridge checks it and asks the
   * person. Anything that is not such a link is ignored there.
   */
  private void takeLink(Intent intent) {
    if (intent == null
        || totr == null
        || !Intent.ACTION_VIEW.equals(intent.getAction())
        || intent.getData() == null) return;
    final String link = intent.getData().toString();
    setIntent(new Intent()); // handled once
    new Thread(() -> totr.acceptLink(link), "totr-invite").start();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    takeLink(intent);
  }

  @Override
  public void onDestroy() {
    if (totr != null) totr.close();
    PlaybackService.listener = null;
    Updater.reporter = null;
    OfflineStore.progress = null;
    if (isFinishing())
      stopService(
          new Intent(
              this,
              PlaybackService
                  .class)); // closing the app ends the music, the way the other players do
    super.onDestroy();
  }
}
