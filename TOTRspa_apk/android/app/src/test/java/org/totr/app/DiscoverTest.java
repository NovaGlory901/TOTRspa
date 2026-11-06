package org.totr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class DiscoverTest {
  private static final String FP = "1522-0d9c-dfd2-6c9d-87a4-6a0f";

  private static Map<String, String> txt(String... items) {
    return Discover.parseTxt(Arrays.asList(items));
  }

  private static Map<String, String> good() {
    return txt("v=1", "join=1", "n=Rae's box", "https=8443", "fp=" + FP);
  }

  private static List<String> a(String... x) {
    return Arrays.asList(x);
  }

  @Test
  public void localAddressesAreExactlyThePrivateRanges() {
    for (String ok :
        new String[] {
          "10.0.0.1",
          "10.255.255.255",
          "172.16.0.1",
          "172.31.255.255",
          "192.168.1.5",
          "169.254.10.10",
          "100.64.0.1",
          "100.127.255.255"
        }) assertTrue(ok, Discover.isLocalV4(ok));
    for (String bad :
        new String[] {
          "8.8.8.8",
          "172.15.0.1",
          "172.32.0.1",
          "192.0.2.5",
          "192.169.0.1",
          "100.63.0.1",
          "100.128.0.1",
          "169.253.0.1",
          "11.0.0.1",
          "127.0.0.1",
          "0.0.0.0",
          "256.1.1.1",
          "10.0.0.256",
          "10.300.0.1",
          "192.168.1.999",
          "10.0.0",
          "10.0.0.1.5",
          "",
          "::1",
          "fe80::1",
          "fd00::1",
          "10.0.0.1 ",
          "a.b.c.d",
          null
        }) assertFalse(String.valueOf(bad), Discover.isLocalV4(bad));
  }

  @Test
  public void aGoodAnnouncementBecomesAServer() {
    Discover.Found f = Discover.describe("totr-box", good(), a("192.168.1.20"));
    assertNotNull(f);
    assertEquals("Rae's box", f.name);
    assertEquals("https://192.168.1.20:8443", f.origin);
    assertEquals("192.168.1.20", f.address);
    assertEquals(FP, f.fingerprint);
    assertEquals("totr-box", f.instance);
  }

  @Test
  public void theWrongShapeIsIgnored() {
    assertNull(Discover.describe("x", txt("v=2", "join=1", "n=A", "https=8443"), a("10.0.0.2")));
    assertNull(Discover.describe("x", txt("join=1", "n=A", "https=8443"), a("10.0.0.2")));
    assertNull(
        Discover.describe(
            "x",
            txt("v=1", "join=0", "n=A", "https=8443"),
            a("10.0.0.2"))); // not taking join requests
    assertNull(Discover.describe("x", txt("v=1", "n=A", "https=8443"), a("10.0.0.2")));
    assertNull(Discover.describe("x", null, a("10.0.0.2")));
  }

  @Test
  public void onlyLocalAddressesCount() {
    assertNull(Discover.describe("x", good(), a("8.8.8.8")));
    assertNull(Discover.describe("x", good(), Collections.<String>emptyList()));
    assertNull(Discover.describe("x", good(), null));
    assertEquals(
        "10.0.0.9",
        Discover.describe("x", good(), a("8.8.8.8", "10.0.0.9", "192.168.1.1"))
            .address); // the first local one wins, a public one never does
  }

  @Test
  public void aServerWithoutAnHttpsPortCannotBeUsed() {
    assertNull(Discover.describe("x", txt("v=1", "join=1", "n=A", "http=8080"), a("10.0.0.2")));
    assertNull(Discover.describe("x", txt("v=1", "join=1", "n=A", "https=0"), a("10.0.0.2")));
    assertNull(Discover.describe("x", txt("v=1", "join=1", "n=A", "https=70000"), a("10.0.0.2")));
    assertNull(Discover.describe("x", txt("v=1", "join=1", "n=A", "https=80a"), a("10.0.0.2")));
    assertNull(Discover.describe("x", txt("v=1", "join=1", "n=A", "https=-1"), a("10.0.0.2")));
    assertNotNull(
        Discover.describe("x", txt("v=1", "join=1", "n=A", "https=65535"), a("10.0.0.2")));
  }

  @Test
  public void namesAreCleanedAndCut() {
    assertEquals(
        "Evil name",
        Discover.describe(
                "x", txt("v=1", "join=1", "n=Evil\n\u0000  name", "https=8443"), a("10.0.0.2"))
            .name);
    assertEquals(
        40,
        Discover.describe(
                "x", txt("v=1", "join=1", "n=" + "n".repeat(100), "https=8443"), a("10.0.0.2"))
            .name
            .length());
    assertEquals(
        "fallback",
        Discover.describe("fallback", txt("v=1", "join=1", "n=   ", "https=8443"), a("10.0.0.2"))
            .name); // no name given: the service label
    assertNull(Discover.describe("", txt("v=1", "join=1", "https=8443"), a("10.0.0.2")));
    assertEquals(
        "ab",
        Discover.clean("a\u202eb", 10)
            .replace(" ", "")); // a right-to-left override cannot hide in a name
  }

  @Test
  public void aBadFingerprintIsDroppedNotTrusted() {
    assertEquals(
        "",
        Discover.describe("x", txt("v=1", "join=1", "n=A", "https=8443", "fp=nope"), a("10.0.0.2"))
            .fingerprint);
    assertEquals(
        "",
        Discover.describe(
                "x",
                txt("v=1", "join=1", "n=A", "https=8443", "fp=" + FP.toUpperCase()),
                a("10.0.0.2"))
            .fingerprint);
    assertEquals(
        "",
        Discover.describe("x", txt("v=1", "join=1", "n=A", "https=8443"), a("10.0.0.2"))
            .fingerprint);
  }

  @Test
  public void announcementTextIsCapped() {
    List<String> many = new ArrayList<>();
    many.add("v=1");
    many.add("join=1");
    many.add("https=8443");
    for (int i = 0; i < 30; i++) many.add("k" + i + "=" + i);
    Map<String, String> t = Discover.parseTxt(many);
    assertTrue(t.size() <= 20); // at most 20 items
    assertEquals("1", t.get("v"));
    List<String> big = new ArrayList<>();
    big.add("v=1");
    big.add("junk=" + "x".repeat(700));
    big.add("join=1");
    Map<String, String> t2 = Discover.parseTxt(big);
    assertEquals("1", t2.get("v"));
    assertNull(t2.get("junk")); // over 600 characters in all: reading stops
    assertNull(t2.get("join"));
    assertEquals(0, Discover.parseTxt(null).size());
    assertEquals("B", Discover.parseTxt(Arrays.asList("KEY=B")).get("key")); // keys are lower case
    assertEquals(0, Discover.parseTxt(Arrays.asList("=novalue", "nokey")).size());
  }

  @Test
  public void manyAddressesAreFineAndOnlyTheFirstLocalOneIsUsed() {
    List<String> many = new ArrayList<>();
    for (int i = 0; i < 20; i++) many.add("8.8.8." + i);
    many.add("10.0.0.7");
    many.add("10.0.0.8");
    assertEquals("10.0.0.7", Discover.describe("x", good(), many).address);
  }
}
