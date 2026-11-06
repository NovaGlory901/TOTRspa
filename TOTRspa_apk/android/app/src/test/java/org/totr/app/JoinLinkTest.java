package org.totr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class JoinLinkTest {
  private static final String CODE = "1522-0d9c-dfd2-6c9d-87a4-6a0f",
      TOKEN = "QU9BjH1X1lFdGTvEW88MngiHIzEWtpzjCGbsY5WCys0";

  @Test
  public void anInviteLinkWithACodeParses() {
    JoinLink j = JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "#fp=" + CODE);
    assertNotNull(j);
    assertEquals("https://10.0.0.50:8443", j.origin);
    assertEquals(TOKEN, j.token);
    assertEquals(CODE, j.code);
  }

  @Test
  public void theAppLinkFormIsTheSameInvite() {
    JoinLink j =
        JoinLink.parse("totr://Box.local:8443/invite/" + TOKEN + "#fp=" + CODE.toUpperCase());
    assertNotNull(j);
    assertEquals("https://box.local:8443", j.origin);
    assertEquals(CODE, j.code);
  }

  @Test
  public void justAnAddressAndACodeParsesWithNoToken() {
    JoinLink j = JoinLink.parse("  https://friend.lan#fp=" + CODE + " ");
    assertNotNull(j);
    assertEquals("https://friend.lan", j.origin);
    assertEquals("", j.token);
    assertNotNull(JoinLink.parse("https://friend.lan/#fp=" + CODE));
  }

  @Test
  public void withoutACodeOrWithABadOneItIsRefused() {
    assertNull(JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN));
    assertNull(JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "#"));
    assertNull(JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "#fp="));
    assertNull(
        JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "#fp=" + CODE.substring(1)));
    assertNull(JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "#fp=" + CODE + "0"));
    assertNull(
        JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "#fp=" + CODE.replace("-", "")));
    assertNull(
        JoinLink.parse(
            "https://10.0.0.50:8443/invite/" + TOKEN + "#fp=zzzz-0d9c-dfd2-6c9d-87a4-6a0f"));
    assertNull(JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "#other=" + CODE));
  }

  @Test
  public void onlyHttpsOrTotrAndOnlyTheInvitePathAreAccepted() {
    assertNull(JoinLink.parse("http://10.0.0.50:8443/invite/" + TOKEN + "#fp=" + CODE));
    assertNull(JoinLink.parse("javascript:alert(1)#fp=" + CODE));
    assertNull(JoinLink.parse("ftp://10.0.0.50/invite/" + TOKEN + "#fp=" + CODE));
    assertNull(JoinLink.parse("https://10.0.0.50:8443/admin/users#fp=" + CODE));
    assertNull(
        JoinLink.parse(
            "https://10.0.0.50:8443/invite/x#fp=" + CODE)); // a token too short to be one
    assertNull(JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "/more#fp=" + CODE));
    assertNull(JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "?next=x#fp=" + CODE));
    assertNull(JoinLink.parse("https://user:pw@10.0.0.50:8443/invite/" + TOKEN + "#fp=" + CODE));
    assertNull(JoinLink.parse("https:///invite/" + TOKEN + "#fp=" + CODE));
  }

  @Test
  public void junkAndHugeInputIsRefusedCleanly() {
    assertNull(JoinLink.parse(null));
    assertNull(JoinLink.parse(""));
    assertNull(JoinLink.parse("not a link at all"));
    assertNull(
        JoinLink.parse("https://10.0.0.50:8443/invite/" + TOKEN + "#fp=" + CODE + "x".repeat(500)));
    assertNotNull(
        JoinLink.parse(
            "https://"
                + "a".repeat(60)
                + ".lan:8443/invite/"
                + TOKEN
                + "#fp="
                + CODE)); // long but sane
    assertNull(
        JoinLink.parse(
            "https://"
                + "a".repeat(380)
                + ".lan:8443/invite/"
                + TOKEN
                + "#fp="
                + CODE)); // otherwise valid, but over the length cap
    assertNull(JoinLink.parse("https://10.0.0.50:99999/invite/" + TOKEN + "#fp=" + CODE));
    assertNull(JoinLink.parse("https://exa mple.com/invite/" + TOKEN + "#fp=" + CODE));
  }
}
