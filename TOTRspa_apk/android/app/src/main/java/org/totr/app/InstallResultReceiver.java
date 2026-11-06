package org.totr.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * Android's answer to an install session: ask the person to confirm when it needs that, otherwise
 * report how it went.
 */
public class InstallResultReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
    String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
      if (confirm != null) {
        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(confirm);
        Updater.say("confirm", 100, "waiting for you to press Update");
      }
    } else if (status == PackageInstaller.STATUS_SUCCESS) {
      Updater.say(
          "done", 100, "updated"); // normally the app restarts as the new version takes over
    } else {
      Updater.say(
          "error",
          0,
          message == null ? "Android refused the update (code " + status + ")" : message);
    }
  }
}
