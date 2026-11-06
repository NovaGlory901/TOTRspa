package org.totr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class AccessListTest {
  private static final String HOME = "https://10.0.0.60:8443",
      FRIEND = "https://friend.example:8443";

  @Test
  public void originOfKeepsSchemeHostAndPortOnly() {
    assertEquals(HOME, AccessList.originOf("https://10.0.0.60:8443/app/#/you"));
    assertEquals("https://friend.example", AccessList.originOf("https://FRIEND.example:443/x?y=1"));
    assertNull(AccessList.originOf("http://10.0.0.60:8443")); // plain http is never a TOTR server
    assertNull(AccessList.originOf("javascript:alert(1)"));
    assertNull(AccessList.originOf(""));
    assertNull(AccessList.originOf(null));
  }

  @Test
  public void aServerOnTheListIsAllowed() {
    assertTrue(AccessList.has(HOME + " " + FRIEND, HOME));
    assertTrue(AccessList.has(HOME + " " + FRIEND, FRIEND));
  }

  @Test
  public void aServerNotOnTheListIsNot() {
    assertFalse(AccessList.has(HOME, FRIEND));
    assertFalse(AccessList.has("", HOME));
  }

  @Test
  public void noPageOrNoOriginIsNeverAllowed() {
    assertFalse(AccessList.has(HOME, ""));
    assertFalse(AccessList.has(HOME, null));
    assertFalse(AccessList.has("", ""));
  }

  @Test
  public void anotherPortOrSchemeOrLookAlikeIsNotTheSameServer() {
    assertFalse(AccessList.has(HOME, "https://10.0.0.60:9999"));
    assertFalse(AccessList.has(HOME, "https://10.0.0.60"));
    assertFalse(AccessList.has(HOME, "http://10.0.0.60:8443"));
    assertFalse(AccessList.has(HOME, HOME + ".evil.example"));
    assertFalse(
        AccessList.has(HOME, HOME + "/")); // only the exact form counts; callers pass originOf(url)
  }

  @Test
  public void storedDataMissingOrCorruptCountsAsEmpty() {
    assertFalse(AccessList.has(null, HOME));
    assertFalse(AccessList.has("   ", HOME));
    assertTrue(AccessList.parse(null).isEmpty());
    assertTrue(AccessList.parse("{{ not a list ]]").isEmpty());
    assertTrue(AccessList.parse("\u0000￿ \n\t").isEmpty());
  }

  @Test
  public void lookAlikesInTheStoredTextAreIgnoredButGoodEntriesStay() {
    String stored =
        HOME
            + "/ "
            + HOME
            + "/x http://10.0.0.60:8443 5 null "
            + FRIEND
            + " "
            + FRIEND
            + " https://UPPER.example";
    assertEquals(
        Arrays.asList(FRIEND),
        AccessList.parse(
            stored)); // the exact form only; no repeats; upper case is not the stored form
    assertFalse(AccessList.has(stored, HOME));
  }

  @Test
  public void grantAddsOnceAndRefusesNonOrigins() {
    String once = AccessList.grant(null, HOME);
    assertEquals(HOME, once);
    assertEquals(once, AccessList.grant(once, HOME));
    assertEquals(HOME + " " + FRIEND, AccessList.grant(once, FRIEND));
    assertEquals(HOME, AccessList.grant(HOME, "http://evil.example"));
    assertEquals(HOME, AccessList.grant(HOME, HOME + "/path"));
    assertEquals(HOME, AccessList.grant(HOME, ""));
    assertEquals(HOME, AccessList.grant(HOME, null));
  }

  @Test
  public void grantOnDamagedStoredTextStartsFresh() {
    assertEquals(HOME, AccessList.grant("%%% broken %%%", HOME));
  }

  @Test
  public void theListHasALimit() {
    String stored = null;
    for (int i = 0; i < AccessList.MAX + 10; i++)
      stored = AccessList.grant(stored, "https://h" + i + ".example");
    assertEquals(AccessList.MAX, AccessList.parse(stored).size());
    assertFalse(AccessList.has(stored, "https://h" + (AccessList.MAX + 5) + ".example"));
  }

  @Test
  public void revokeTakesOneOut() {
    assertEquals(FRIEND, AccessList.revoke(HOME + " " + FRIEND, HOME));
    assertEquals(HOME, AccessList.revoke(HOME, FRIEND));
  }

  @Test
  public void theAppsOwnPagesAreRecognisedByTheirOrigin() {
    assertTrue(AccessList.isOwnPage(AccessList.originOf("https://localhost/offline.html")));
    assertFalse(AccessList.isOwnPage(AccessList.originOf("https://localhost:8443/")));
    assertFalse(AccessList.isOwnPage(AccessList.originOf("https://localhost.evil.example/")));
    assertFalse(AccessList.isOwnPage(""));
  }

  @Test
  public void anOldInstallKeepsTheServersItKnew() {
    assertEquals(
        HOME + " " + FRIEND,
        AccessList.inherit(
            null, Arrays.asList(HOME + "/app/", FRIEND, HOME, "http://plain.example", "")));
  }

  @Test
  public void inheritDoesNothingWhenAListIsStoredOrNothingIsKnown() {
    assertNull(
        AccessList.inherit("", Arrays.asList(HOME))); // the person's choice (an empty list) is kept
    assertNull(AccessList.inherit(HOME, Arrays.asList(FRIEND)));
    assertNull(AccessList.inherit(null, Collections.<String>emptyList()));
    assertNull(AccessList.inherit(null, Arrays.asList("http://plain.example")));
  }

  @Test
  public void onlyAPersonsOwnTapCanRaiseTheAllowQuestionForNearServers() {
    for (String op : new String[] {"start", "ask", "cancel", "finish"})
      assertTrue(op, AccessList.mayAsk(op));
    for (String op : new String[] {"list", "refresh", "stop", "", "nope", null})
      assertFalse(String.valueOf(op), AccessList.mayAsk(op));
  }
}
