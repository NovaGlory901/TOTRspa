package org.totr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.Test;

public class VaultTest {
  private static final String HOME = "https://10.0.0.60:8443", FRIEND = "https://10.0.0.70:8443";

  /**
   * AES-GCM with a random 12-byte nonce in front, like the phone's, but with a key the test holds.
   */
  private static Vault.Crypter crypter(byte fill) {
    final SecretKeySpec key =
        new SecretKeySpec(
            new byte[] {fill, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}, "AES");
    return new Vault.Crypter() {
      public byte[] seal(byte[] plain) throws Exception {
        byte[] iv = new byte[12];
        new SecureRandom().nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(plain), out = new byte[12 + ct.length];
        System.arraycopy(iv, 0, out, 0, 12);
        System.arraycopy(ct, 0, out, 12, ct.length);
        return out;
      }

      public byte[] open(byte[] sealed) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, sealed, 0, 12));
        return c.doFinal(sealed, 12, sealed.length - 12);
      }
    };
  }

  private static Vault reopen(Vault v, Vault.Crypter c) throws Exception {
    return Vault.open(v.seal(c), c);
  }

  @Test
  public void aSavedSignInComesBackAfterSealingAndOpening() throws Exception {
    Vault v = new Vault();
    assertTrue(v.put(HOME, "Dummyuser123", "p@ss wordé日"));
    Vault w = reopen(v, crypter((byte) 7));
    assertEquals("Dummyuser123", w.get(HOME).username);
    assertEquals("p@ss wordé日", w.get(HOME).password);
    assertNull(w.get(FRIEND));
  }

  @Test
  public void nothingReadableIsInTheSealedText() throws Exception {
    Vault v = new Vault();
    v.put(HOME, "Dummyuser123", "hunter2hunter2");
    String sealed = v.seal(crypter((byte) 7));
    for (String secret : new String[] {"Dummyuser123", "hunter2", "10.0.0.60", "https"})
      assertFalse(secret, sealed.contains(secret));
    String plainB64 = Pins.b64encode("Dummyuser123".getBytes(StandardCharsets.UTF_8));
    assertFalse(sealed.contains(plainB64));
  }

  @Test
  public void theSameVaultSealsDifferentlyEachTime() throws Exception {
    Vault v = new Vault();
    v.put(HOME, "u", "p");
    assertFalse(
        v.seal(crypter((byte) 7)).equals(v.seal(crypter((byte) 7)))); // a fresh nonce each time
  }

  @Test
  public void anotherKeyDamageOrTamperingGivesAnEmptyVault() throws Exception {
    Vault v = new Vault();
    v.put(HOME, "u", "p");
    String sealed = v.seal(crypter((byte) 7));
    assertEquals(0, Vault.open(sealed, crypter((byte) 8)).origins().size()); // the wrong key
    byte[] raw = Pins.b64decode(sealed);
    raw[raw.length - 1] ^= 1;
    assertEquals(
        0, Vault.open(Pins.b64encode(raw), crypter((byte) 7)).origins().size()); // one flipped bit
    assertEquals(
        0,
        Vault.open(sealed.substring(0, sealed.length() - 8), crypter((byte) 7))
            .origins()
            .size()); // cut short
    assertEquals(0, Vault.open("not base64!!", crypter((byte) 7)).origins().size());
    assertEquals(0, Vault.open("", crypter((byte) 7)).origins().size());
    assertEquals(0, Vault.open(null, crypter((byte) 7)).origins().size());
    assertEquals(0, Vault.open(sealed, null).origins().size());
  }

  @Test
  public void aSignInBelongsToOneExactOrigin() {
    Vault v = new Vault();
    v.put(HOME, "u", "p");
    assertNotNull(v.get(HOME));
    for (String other :
        new String[] {
          "https://10.0.0.60:9999",
          "https://10.0.0.60",
          "http://10.0.0.60:8443",
          HOME + "/",
          HOME + ".evil.example",
          "https://10.0.0.61:8443",
          "",
          null
        }) assertNull(String.valueOf(other), v.get(other));
  }

  @Test
  public void onlyAnExactHttpsOriginCanBeSavedFor() {
    Vault v = new Vault();
    for (String bad :
        new String[] {
          "http://10.0.0.60:8443",
          HOME + "/",
          HOME + "/x",
          "10.0.0.60:8443",
          "",
          null,
          "javascript:alert(1)"
        }) assertFalse(String.valueOf(bad), v.put(bad, "u", "p"));
    assertEquals(0, v.origins().size());
  }

  @Test
  public void oddUsernamesAndPasswordsAreRefused() {
    Vault v = new Vault();
    assertFalse(v.put(HOME, "", "p"));
    assertFalse(v.put(HOME, "u", ""));
    assertFalse(v.put(HOME, null, "p"));
    assertFalse(v.put(HOME, "u", null));
    assertFalse(v.put(HOME, "u\nx", "p"));
    assertFalse(v.put(HOME, "u", "p\u0000"));
    assertFalse(v.put(HOME, "x".repeat(65), "p"));
    assertFalse(v.put(HOME, "u", "x".repeat(129)));
    assertTrue(v.put(HOME, "x".repeat(64), "y".repeat(128)));
  }

  @Test
  public void thereIsALimitAndReplacingOneIsFine() {
    Vault v = new Vault();
    for (int i = 0; i < Vault.MAX; i++)
      assertTrue(v.put("https://10.0.1." + i + ":8443", "u", "p"));
    assertFalse(v.put("https://10.0.2.1:8443", "u", "p"));
    assertFalse(v.markNever("https://10.0.2.1:8443"));
    assertTrue(v.put("https://10.0.1.3:8443", "other", "p2"));
    assertEquals("other", v.get("https://10.0.1.3:8443").username);
    v.forget("https://10.0.1.3:8443");
    assertTrue(v.put("https://10.0.2.1:8443", "u", "p"));
  }

  @Test
  public void signingOutByHandStopsAutomaticSignInUntilTheNextManualOne() throws Exception {
    Vault v = new Vault();
    v.put(HOME, "u", "p");
    assertNotNull(v.nextAutoTry(HOME, 0));
    v.markSignedOut(HOME);
    assertNull(v.nextAutoTry(HOME, 1_000_000));
    Vault w = reopen(v, crypter((byte) 7)); // the flag survives a restart
    assertNull(w.nextAutoTry(HOME, 1_000_000));
    assertNotNull(w.get(HOME)); // the account is still saved
    w.put(HOME, "u", "p"); // signing in by hand again
    assertNotNull(w.nextAutoTry(HOME, 2_000_000));
  }

  @Test
  public void automaticTriesAreSpacedByThirtySeconds() {
    Vault v = new Vault();
    v.put(HOME, "u", "p");
    assertNotNull(v.nextAutoTry(HOME, 100_000));
    assertNull(v.nextAutoTry(HOME, 100_000 + 29_999));
    assertNotNull(v.nextAutoTry(HOME, 100_000 + 30_000));
    assertNull(v.nextAutoTry(HOME, 130_001));
    assertNotNull(
        v.nextAutoTry(HOME, 50_000)); // the phone's clock was set back: not locked out for hours
  }

  @Test
  public void threeRefusalsStopTheTriesUntilASuccessOrAManualSignIn() throws Exception {
    Vault v = new Vault();
    v.put(HOME, "u", "p");
    long t = 0;
    for (int i = 0; i < 3; i++) {
      assertNotNull("try " + i, v.nextAutoTry(HOME, t += 40_000));
      v.failed(HOME);
    }
    assertNull(v.nextAutoTry(HOME, t += 40_000));
    assertNull(
        reopen(v, crypter((byte) 7)).nextAutoTry(HOME, 9_999_999)); // the count survives a restart
    v.put(HOME, "u", "new-password"); // the person signed in by hand with the new password
    assertNotNull(v.nextAutoTry(HOME, t += 40_000));
  }

  @Test
  public void aSuccessClearsTheFailureCount() {
    Vault v = new Vault();
    v.put(HOME, "u", "p");
    v.failed(HOME);
    v.failed(HOME);
    v.succeeded(HOME);
    v.failed(HOME);
    v.failed(HOME);
    assertNotNull(v.nextAutoTry(HOME, 1_000_000)); // 2 failures since the success: still allowed
  }

  @Test
  public void neverForThisServerSticksUntilForgotten() throws Exception {
    Vault v = new Vault();
    assertTrue(v.markNever(FRIEND));
    assertTrue(v.isNever(FRIEND));
    assertFalse(v.put(FRIEND, "u", "p"));
    assertNull(v.get(FRIEND));
    assertEquals(0, v.origins().size());
    assertTrue(reopen(v, crypter((byte) 7)).isNever(FRIEND));
    v.forget(FRIEND);
    assertFalse(v.isNever(FRIEND));
    assertTrue(v.put(FRIEND, "u", "p"));
  }

  @Test
  public void forgetRemovesOnlyThatServer() {
    Vault v = new Vault();
    v.put(HOME, "a", "pa");
    v.put(FRIEND, "b", "pb");
    v.forget(HOME);
    assertNull(v.get(HOME));
    assertEquals("b", v.get(FRIEND).username);
    assertNull(v.nextAutoTry(HOME, 5));
  }

  @Test
  public void aStoredTextWithBadLinesKeepsTheGoodOnes() throws Exception {
    Vault.Crypter c = crypter((byte) 7);
    String b = Pins.b64encode("x".getBytes(StandardCharsets.UTF_8)),
        b2 = Pins.b64encode("second".getBytes(StandardCharsets.UTF_8));
    String text =
        "junk\n"
            + HOME
            + "\t"
            + b
            + "\t"
            + b
            + "\t0\t0\t0\n"
            + "http://bad:1\t"
            + b
            + "\t"
            + b
            + "\t0\t0\t0\n"
            + HOME
            + "\t"
            + b2
            + "\t"
            + b
            + "\t0\t0\t0\n"
            + FRIEND
            + "\t!!\t"
            + b
            + "\t0\t0\t0\n"
            + "https://10.0.0.5:8443\t"
            + b
            + "\t"
            + b
            + "\t0\tx\t0\n";
    Vault v = Vault.open(Pins.b64encode(c.seal(text.getBytes(StandardCharsets.UTF_8))), c);
    assertEquals(
        1,
        v.origins()
            .size()); // the first good line only: a repeat, a bad origin, bad text and a bad number
    // are skipped
    assertEquals("x", v.get(HOME).username); // the first of two lines for one server wins
  }

  @Test
  public void generatedPasswordsAreLongRandomAndReadable() {
    SecureRandom r = new SecureRandom();
    java.util.Set<String> seen = new java.util.HashSet<>();
    for (int i = 0; i < 200; i++) {
      String p = Vault.newPassword(r);
      assertEquals(24, p.length());
      assertTrue(p, p.matches("[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]{24}"));
      assertFalse(p.matches(".*[01OIl].*")); // no look-alikes
      seen.add(p);
    }
    assertEquals(200, seen.size());
    assertTrue(new Vault().put(HOME, "u", Vault.newPassword(r))); // always acceptable to the vault
  }
}
