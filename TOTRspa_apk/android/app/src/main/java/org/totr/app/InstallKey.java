package org.totr.app;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;

/**
 * This app install's own signing key for join requests: an EC P-256 key made once inside Android's
 * key store (the protected place apps cannot copy a key out of) and used to sign every request, so
 * a server's admin can see "the same install as before". It cannot prove the app is unmodified.
 * Android's key store has no Ed25519 on the phones this app supports, which is why the server
 * accepts P-256 (TOTRsrv/auth/join.py).
 */
final class InstallKey {
  private InstallKey() {}

  private static final String ALIAS = "totr-install-key";

  private static synchronized KeyStore store() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    if (!ks.containsAlias(ALIAS)) {
      KeyPairGenerator g =
          KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
      g.initialize(
          new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
              .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
              .setDigests(KeyProperties.DIGEST_SHA256)
              .build());
      g.generateKeyPair();
    }
    return ks;
  }

  /** The key's public point, 65 bytes. */
  static byte[] publicPoint() throws Exception {
    return JoinRequest.uncompressedPoint(
        (ECPublicKey) store().getCertificate(ALIAS).getPublicKey());
  }

  static JoinRequest.Signer signer() {
    return message -> {
      Signature s = Signature.getInstance("SHA256withECDSA");
      s.initSign((PrivateKey) store().getKey(ALIAS, null));
      s.update(message);
      return s.sign();
    };
  }
}
