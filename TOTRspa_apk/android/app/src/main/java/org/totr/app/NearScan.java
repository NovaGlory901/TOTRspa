package org.totr.app;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Looks for TOTR servers on the same Wi-Fi (Android's NsdManager, "Bonjour", service _totr._tcp),
 * the phone's version of the desktop app's discover.cjs. Every announcement is hostile input and
 * goes through Discover's rules before it shows. It only runs while the page asks for it (the
 * person has the "servers near you" list open) and holds the Wi-Fi multicast lock only for that
 * time: Android otherwise drops the broadcast packets this needs.
 */
final class NearScan {
  private static final String TYPE = "_totr._tcp.";

  private final Context context;
  private final NsdManager nsd;
  private WifiManager.MulticastLock lock;
  private NsdManager.DiscoveryListener listener;
  private final Map<String, Discover.Found> found =
      new LinkedHashMap<>(); // service name -> what it announced; kept until Android says it is
  // gone (onServiceLost) or the scan stops
  private final List<NsdServiceInfo> queue = new ArrayList<>();
  private boolean resolving;

  NearScan(Context context) {
    this.context = context.getApplicationContext();
    this.nsd = (NsdManager) this.context.getSystemService(Context.NSD_SERVICE);
  }

  /**
   * Starts looking. "" when it started (or was already looking), otherwise a sentence for the
   * person.
   */
  synchronized String start() {
    if (listener != null) return "";
    if (nsd == null) return "This phone cannot look for servers on the network.";
    try {
      WifiManager wifi = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
      if (wifi != null) {
        lock = wifi.createMulticastLock("totr-near");
        lock.setReferenceCounted(false);
        lock.acquire();
      }
      listener =
          new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String type) {}

            @Override
            public void onDiscoveryStopped(String type) {}

            @Override
            public void onStartDiscoveryFailed(String type, int code) {
              drop();
            }

            @Override
            public void onStopDiscoveryFailed(String type, int code) {}

            @Override
            public void onServiceFound(NsdServiceInfo info) {
              enqueue(info);
            }

            @Override
            public void onServiceLost(NsdServiceInfo info) {
              synchronized (NearScan.this) {
                found.remove(info.getServiceName());
              }
            }
          };
      nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
      return "";
    } catch (Exception e) {
      drop();
      return "Looking for servers on the network did not start. The network may not allow it.";
    }
  }

  private synchronized void drop() {
    if (listener != null) {
      try {
        nsd.stopServiceDiscovery(listener);
      } catch (Exception e) {
        /* already stopped */
      }
    }
    listener = null;
    if (lock != null && lock.isHeld()) lock.release();
    lock = null;
    found.clear();
    queue.clear();
    resolving = false;
  }

  synchronized void stop() {
    drop();
  }

  private synchronized void enqueue(NsdServiceInfo info) {
    if (queue.size() < Discover.MAX_SERVERS * 2)
      queue.add(info); // a flood of announcements does not grow the queue without limit
    next();
  }

  private synchronized void next() { // one resolve at a time: Android does not allow two at once
    if (resolving || queue.isEmpty() || listener == null) return;
    resolving = true;
    NsdServiceInfo info = queue.remove(0);
    try {
      nsd.resolveService(
          info,
          new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo i, int code) {
              done();
            }

            @Override
            public void onServiceResolved(NsdServiceInfo i) {
              accept(i);
              done();
            }
          });
    } catch (Exception e) {
      done();
    }
  }

  private synchronized void done() {
    resolving = false;
    next();
  }

  private synchronized void accept(NsdServiceInfo info) {
    try {
      if (info.getHost() == null) return;
      List<String> items = new ArrayList<>();
      Map<String, byte[]> attrs = info.getAttributes();
      if (attrs != null)
        for (Map.Entry<String, byte[]> e : attrs.entrySet()) {
          byte[] v = e.getValue() == null ? new byte[0] : e.getValue();
          if (e.getKey() != null && e.getKey().length() <= 20 && v.length <= 200)
            items.add(e.getKey() + "=" + new String(v, StandardCharsets.UTF_8));
        }
      Discover.Found f =
          Discover.describe(
              info.getServiceName(),
              Discover.parseTxt(items),
              Collections.singletonList(info.getHost().getHostAddress()));
      String key = info.getServiceName();
      if (f == null
          || key == null
          || key.length() > 80
          || (!found.containsKey(key) && found.size() >= Discover.MAX_SERVERS)) return;
      found.put(key, f);
    } catch (Exception e) {
      /* a damaged announcement is dropped */
    }
  }

  /**
   * {"list":[{"name","origin","address","fingerprint"}]}. Nothing is dropped by age: Android tells
   * the app once when a server appears and once when it goes away, and does not repeat the first,
   * so a list that expired entries on a timer would be empty for good after two minutes (found on a
   * real phone).
   */
  synchronized String listJson() {
    JSONArray arr = new JSONArray();
    List<Discover.Found> out = new ArrayList<>(found.values());
    Collections.sort(out, (a, b) -> a.name.compareToIgnoreCase(b.name));
    try {
      for (Discover.Found f : out)
        arr.put(
            new JSONObject()
                .put("name", f.name)
                .put("origin", f.origin)
                .put("address", f.address)
                .put("fingerprint", f.fingerprint));
      return new JSONObject().put("list", arr).toString();
    } catch (Exception e) {
      return "{\"list\":[]}";
    }
  }
}
