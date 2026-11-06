package org.totr.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;
import java.io.InputStream;
import java.net.HttpURLConnection;

/**
 * Keeps the music going with the screen off and puts play / pause / next / previous on the lock
 * screen and in the notification shade. The page (served by the TOTR server) tells it what is
 * playing through TotrBridge; the buttons are sent back to the page, which owns the audio. While
 * something plays it holds a CPU wake lock and a Wi-Fi lock, because without them the phone puts
 * Wi-Fi to sleep and the stream runs dry a little while after the screen goes off.
 */
public class PlaybackService extends Service {
  static final String CHANNEL = "playback";
  private static final int NOTE_ID = 7;

  /** Where the buttons go: the activity forwards them to the page. */
  public interface Listener {
    void onAction(String action);

    void onSeek(long ms);
  }

  static volatile Listener listener;
  static volatile PlaybackService instance;

  /** What the page last told us; the service shows it as soon as it starts. */
  static final class State {
    String title = "";
    String artist = "";
    boolean playing;
    long positionMs;
    long durationMs;
    String coverUrl = "";
  }

  static final State state = new State();

  /**
   * The last thing that went wrong in here (shown on the You page, so a problem on a phone can be
   * read without a computer).
   */
  static volatile String lastError = "";

  private MediaSessionCompat session;
  private NotificationManager notes;
  private PowerManager.WakeLock wake;
  private WifiManager.WifiLock wifi;
  private boolean foreground;
  private Bitmap art; // the cover shown on the lock screen and in the notification
  private String artFor = ""; // the address `art` was loaded from (or is being loaded from)

  /**
   * The cover for the song now playing: an http(s) address on the server (fetched with the app's
   * sign-in cookie) or https://localhost/_offline/<file>.
   */
  static void setCover(String address) {
    state.coverUrl = address == null ? "" : address;
    PlaybackService s = instance;
    if (s != null) s.apply();
  }

  @SuppressWarnings("deprecation")
  @Override
  public void onCreate() {
    super.onCreate();
    instance = this;
    notes = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch =
          new NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW);
      ch.setShowBadge(false);
      notes.createNotificationChannel(ch);
    }
    session = new MediaSessionCompat(this, "TOTR");
    session.setCallback(
        new MediaSessionCompat.Callback() {
          @Override
          public void onPlay() {
            send("play");
          }

          @Override
          public void onPause() {
            send("pause");
          }

          @Override
          public void onStop() {
            send("pause");
          }

          @Override
          public void onSkipToNext() {
            send("next");
          }

          @Override
          public void onSkipToPrevious() {
            send("prev");
          }

          @Override
          public void onSeekTo(long pos) {
            Listener l = listener;
            if (l != null) l.onSeek(pos);
          }
        });
    session.setActive(true);
    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TOTR:playback");
    wake.setReferenceCounted(false);
    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    if (wm != null) {
      wifi =
          wm.createWifiLock(
              WifiManager.WIFI_MODE_FULL_HIGH_PERF,
              "TOTR:playback"); // deprecated name, still the one that works on every version we
      // support
      wifi.setReferenceCounted(false);
    }
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    try {
      if (intent != null && Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction()))
        MediaButtonReceiver.handleIntent(session, intent);
      apply();
    } catch (RuntimeException e) {
      lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
    }
    return START_NOT_STICKY;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  private void send(String action) {
    Listener l = listener;
    if (l != null) l.onAction(action);
  }

  /** Shows the current State: session, notification, locks. */
  synchronized void apply() {
    State s = state;
    if (!s.coverUrl.equals(artFor)) loadArt(s.coverUrl);
    MediaMetadataCompat.Builder meta =
        new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
            .putLong(
                MediaMetadataCompat.METADATA_KEY_DURATION, s.durationMs > 0 ? s.durationMs : -1);
    if (art != null)
      meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art)
          .putBitmap(MediaMetadataCompat.METADATA_KEY_ART, art);
    session.setMetadata(meta.build());
    long actions =
        PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_SEEK_TO;
    session.setPlaybackState(
        new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(
                s.playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                s.positionMs,
                s.playing ? 1f : 0f)
            .build());
    Notification n = notification(s);
    if (s.playing) {
      if (!wake.isHeld()) wake.acquire();
      if (wifi != null && !wifi.isHeld()) wifi.acquire();
      if (Build.VERSION.SDK_INT >= 29)
        startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
      else startForeground(NOTE_ID, n);
      foreground = true;
    } else {
      release();
      if (foreground) {
        stopForeground(false);
        foreground = false;
      } // the notification stays (so you can press play), the service may be stopped by the system
      notes.notify(NOTE_ID, n);
    }
  }

  private void release() {
    if (wake != null && wake.isHeld()) wake.release();
    if (wifi != null && wifi.isHeld()) wifi.release();
  }

  /**
   * Fetches the cover in the background and shows it when it arrives (the notification is shown
   * right away without it).
   */
  private void loadArt(final String address) {
    artFor = address;
    art = null;
    if (address.isEmpty()) return;
    new Thread(
            () -> {
              Bitmap bmp = null;
              try {
                java.net.URI u = new java.net.URI(address);
                InputStream in;
                HttpURLConnection c = null;
                if ("localhost".equalsIgnoreCase(u.getHost())
                    && u.getPath() != null
                    && u.getPath().startsWith("/_offline/")) {
                  java.io.File f =
                      new OfflineStore(this).file(u.getPath().substring("/_offline/".length()));
                  in = f == null ? null : new java.io.FileInputStream(f);
                } else if ("http".equals(u.getScheme()) || "https".equals(u.getScheme())) {
                  c = PinnedTls.open(address, PinStore.get(this));
                  c.setConnectTimeout(8000);
                  c.setReadTimeout(15000);
                  String cookie = CookieManager.getInstance().getCookie(address);
                  if (cookie != null) c.setRequestProperty("Cookie", cookie);
                  in = c.getResponseCode() == 200 ? c.getInputStream() : null;
                } else in = null;
                if (in != null) {
                  byte[] data;
                  try (InputStream src = in) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = src.read(buf)) > 0) out.write(buf, 0, n);
                    data = out.toByteArray();
                  }
                  BitmapFactory.Options o = new BitmapFactory.Options();
                  o.inJustDecodeBounds = true;
                  BitmapFactory.decodeByteArray(data, 0, data.length, o);
                  int sample = 1;
                  while (o.outWidth / sample > 1024) sample *= 2;
                  o = new BitmapFactory.Options();
                  o.inSampleSize = sample;
                  bmp = BitmapFactory.decodeByteArray(data, 0, data.length, o);
                }
                if (c != null) c.disconnect();
              } catch (Exception e) {
                lastError = "cover: " + e.getClass().getSimpleName();
              }
              synchronized (PlaybackService.this) {
                if (address.equals(state.coverUrl) && instance == PlaybackService.this) {
                  art = bmp;
                  apply();
                }
              }
            },
            "totr-cover")
        .start();
  }

  private PendingIntent button(long action) {
    return MediaButtonReceiver.buildMediaButtonPendingIntent(this, action);
  }

  private Notification notification(State s) {
    Intent open =
        new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(s.title.isEmpty() ? "TOTR" : s.title)
            .setContentText(s.artist)
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    open,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setColor(
                0xFF2A1E5C) // the Dreamspace indigo; with setColorized the notification is drawn in
            // it
            .setColorized(true)
            .setLargeIcon(art)
            .setOngoing(s.playing)
            .setShowWhen(false)
            .addAction(
                R.drawable.ic_prev, "Previous", button(PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
            .addAction(
                s.playing ? R.drawable.ic_pause : R.drawable.ic_play,
                s.playing ? "Pause" : "Play",
                button(PlaybackStateCompat.ACTION_PLAY_PAUSE))
            .addAction(R.drawable.ic_next, "Next", button(PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
            .setStyle(
                new androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(session.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));
    return b.build();
  }

  @Override
  public void onDestroy() {
    release();
    if (session != null) {
      session.setActive(false);
      session.release();
    }
    notes.cancel(NOTE_ID);
    if (instance == this) instance = null;
    super.onDestroy();
  }
}
