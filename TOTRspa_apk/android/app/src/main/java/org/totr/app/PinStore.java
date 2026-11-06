package org.totr.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Where the pinned authorities (Pins) are kept: one string in the app's preferences, shared by the
 * bridge, the WebView client and the code that downloads.
 */
final class PinStore {
  private PinStore() {}

  private static final String KEY = "pins";

  private static SharedPreferences prefs(Context c) {
    return c.getApplicationContext().getSharedPreferences("totr", Context.MODE_PRIVATE);
  }

  /** The stored pins text, or "" when there is none. */
  static String get(Context c) {
    return prefs(c).getString(KEY, "");
  }

  static void set(Context c, String stored) {
    prefs(c).edit().putString(KEY, stored).apply();
  }
}
