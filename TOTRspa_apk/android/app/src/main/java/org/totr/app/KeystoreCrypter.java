package org.totr.app;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Seals the vault with an AES-256-GCM key made inside Android's key store: the app can use it but
 * nobody, the app included, can read the key out. Output: 12-byte nonce + ciphertext.
 */
final class KeystoreCrypter implements Vault.Crypter {
  private static final String ALIAS = "totr-vault-key";

  private static synchronized SecretKey key() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    if (!ks.containsAlias(ALIAS)) {
      KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      g.init(
          new KeyGenParameterSpec.Builder(
                  ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .setKeySize(256)
              .build());
      g.generateKey();
    }
    return (SecretKey) ks.getKey(ALIAS, null);
  }

  @Override
  public byte[] seal(byte[] plain) throws Exception {
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.ENCRYPT_MODE, key());
    byte[] iv = c.getIV(), ct = c.doFinal(plain), out = new byte[iv.length + ct.length];
    System.arraycopy(iv, 0, out, 0, iv.length);
    System.arraycopy(ct, 0, out, iv.length, ct.length);
    return out;
  }

  @Override
  public byte[] open(byte[] sealed) throws Exception {
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, sealed, 0, 12));
    return c.doFinal(sealed, 12, sealed.length - 12);
  }
}
