package org.totr.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Installs a newer TOTR APK from the server. The page says where it is and what its SHA-256 is;
 * this downloads it straight into an Android install session, checks the hash, and hands the
 * session to Android, which shows its normal "Update" button (no tap at all on versions that allow
 * an app to update what it installed itself). Android only accepts the APK if it is signed with the
 * same key as the installed app, so a tampered file cannot replace TOTR. Progress goes back to the
 * page through `reporter`.
 */
final class Updater {
  interface Reporter {
    void say(String stage, int percent, String message);
  }

  static volatile Reporter reporter;

  private final Context context;
  private volatile boolean busy;

  Updater(Context context) {
    this.context = context;
  }

  static void say(String stage, int percent, String message) {
    Reporter r = reporter;
    if (r != null) r.say(stage, percent, message);
  }

  boolean canInstall() {
    return Build.VERSION.SDK_INT < 26 || context.getPackageManager().canRequestPackageInstalls();
  }

  /** Opens Android's "install unknown apps" switch for TOTR (a one-time permission). */
  void openInstallPermission() {
    Intent i =
        new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + context.getPackageName()));
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    context.startActivity(i);
  }

  void start(final String address, final String sha256, final long size) {
    if (busy) return;
    busy = true;
    new Thread(
            () -> {
              try {
                run(address, sha256, size);
              } catch (Exception e) {
                say("error", 0, e.getClass().getSimpleName() + ": " + e.getMessage());
              } finally {
                busy = false;
              }
            },
            "totr-update")
        .start();
  }

  private void run(String address, String sha256, long size) throws Exception {
    if (address == null || !(address.startsWith("http://") || address.startsWith("https://")))
      throw new Exception("not a web address");
    if (!canInstall()) throw new Exception("TOTR is not allowed to install apps yet");
    say("download", 0, "downloading");
    HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
    c.setConnectTimeout(10000);
    c.setReadTimeout(30000);
    if (c.getResponseCode() != 200)
      throw new Exception("the server answered " + c.getResponseCode());
    long total = c.getContentLengthLong() > 0 ? c.getContentLengthLong() : size;

    PackageInstaller installer = context.getPackageManager().getPackageInstaller();
    PackageInstaller.SessionParams params =
        new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
    params.setAppPackageName(context.getPackageName());
    if (total > 0) params.setSize(total);
    if (Build.VERSION.SDK_INT >= 31)
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
    int id = installer.createSession(params);
    PackageInstaller.Session session = installer.openSession(id);
    boolean committed = false;
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      try (InputStream in = c.getInputStream();
          OutputStream out = session.openWrite("TOTR.apk", 0, total > 0 ? total : -1)) {
        byte[] buf = new byte[65536];
        long done = 0;
        int n, last = -1;
        while ((n = in.read(buf)) > 0) {
          out.write(buf, 0, n);
          md.update(buf, 0, n);
          done += n;
          int pct = total > 0 ? (int) (done * 100 / total) : 0;
          if (pct != last) {
            last = pct;
            say("download", pct, "downloading");
          }
        }
        session.fsync(out);
      }
      StringBuilder hex = new StringBuilder();
      for (byte b : md.digest()) hex.append(String.format("%02x", b));
      if (sha256 != null && !sha256.isEmpty() && !hex.toString().equalsIgnoreCase(sha256))
        throw new Exception("the download is damaged (checksum does not match)");
      say("install", 100, "handing it to Android");
      Intent result = new Intent(context, InstallResultReceiver.class);
      PendingIntent pending =
          PendingIntent.getBroadcast(
              context,
              id,
              result,
              PendingIntent.FLAG_UPDATE_CURRENT
                  | PendingIntent.FLAG_MUTABLE); // Android adds its answer to it
      session.commit(pending.getIntentSender());
      committed = true;
    } finally {
      session.close();
      if (!committed) installer.abandonSession(id);
      c.disconnect();
    }
  }
}
