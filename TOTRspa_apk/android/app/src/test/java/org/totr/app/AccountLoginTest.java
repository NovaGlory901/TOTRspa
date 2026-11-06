package org.totr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import org.junit.Test;

public class AccountLoginTest {
  @Test
  public void onlyARefusalCountsAgainstTheSavedPassword() {
    assertEquals(AccountLogin.Result.OK, AccountLogin.classify(200));
    for (int refused : new int[] {401, 403, 422})
      assertEquals(AccountLogin.Result.REFUSED, AccountLogin.classify(refused));
    assertEquals(AccountLogin.Result.THROTTLED, AccountLogin.classify(429));
    for (int other : new int[] {0, 204, 301, 400, 404, 500, 502, 503})
      assertEquals(
          String.valueOf(other), AccountLogin.Result.UNREACHABLE, AccountLogin.classify(other));
  }

  @Test
  public void theLoginBodyIsPlainJsonWithEverythingEscaped() {
    assertEquals("{\"username\":\"rae\",\"password\":\"p\"}", AccountLogin.body("rae", "p"));
    assertEquals(
        "{\"username\":\"a\\\"b\",\"password\":\"x\\\\y\\u000a\\u0000\"}",
        AccountLogin.body("a\"b", "x\\y\n\u0000"));
  }

  @Test
  public void theSessionCookieIsPickedOutOfTheAnswer() {
    String c = "totr_session=abc123; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax; Secure";
    assertEquals(c, AccountLogin.sessionCookie(Arrays.asList("other=1; Path=/", c, "x=y")));
    assertEquals(c, AccountLogin.sessionCookie(Arrays.asList("  " + c + " ")));
  }

  @Test
  public void nothingElseIsTakenAsASession() {
    assertNull(AccountLogin.sessionCookie(null));
    assertNull(AccountLogin.sessionCookie(Arrays.<String>asList()));
    assertNull(
        AccountLogin.sessionCookie(
            Arrays.asList(
                "other=1",
                "totr_sessionx=1",
                "xtotr_session=1",
                "TOTR_SESSION=abc",
                "Totr_Session=abc")));
    assertNull(AccountLogin.sessionCookie(Arrays.asList((String) null)));
  }

  @Test
  public void aDeletedOrOddCookieIsNotASession() {
    assertNull(AccountLogin.sessionCookie(Arrays.asList("totr_session=; Max-Age=0; Path=/")));
    assertNull(AccountLogin.sessionCookie(Arrays.asList("totr_session=;")));
    assertNull(
        AccountLogin.sessionCookie(
            Arrays.asList("totr_session=" + "a".repeat(2000)))); // over the size cap
  }

  @Test
  public void aCookieForAnotherDomainIsRefused() {
    assertNull(
        AccountLogin.sessionCookie(Arrays.asList("totr_session=abc; Domain=evil.example; Path=/")));
    assertNull(
        AccountLogin.sessionCookie(Arrays.asList("totr_session=abc; Path=/; DOMAIN=10.0.0.1")));
  }
}
