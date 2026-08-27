import crypto from 'node:crypto';

function getKey() {
  const encoded = process.env.ANNYPAY_MASTER_KEY;
  if (!encoded) throw new Error('Missing ANNYPAY_MASTER_KEY');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('ANNYPAY_MASTER_KEY must be a base64 encoded 32-byte key');
  return key;
}

export function createDatabaseSecretStore(admin) {
  const key = getKey();
  return {
    async put(id, plaintext, { merchantId = null, purpose = 'integration' } = {}) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const { error } = await admin.from('integration_secrets').upsert({
        id,
        merchant_id: merchantId,
        purpose,
        ciphertext: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        auth_tag: tag.toString('base64'),
        rotated_at: new Date().toISOString()
      });
      if (error) throw error;
      return id;
    },

    async get(id) {
      if (!id) return null;
      const { data, error } = await admin.from('integration_secrets')
        .select('ciphertext,iv,auth_tag').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(data.auth_tag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(data.ciphertext, 'base64')),
        decipher.final()
      ]);
      return decrypted.toString('utf8');
    },

    async delete(id) {
      const { error } = await admin.from('integration_secrets').delete().eq('id', id);
      if (error) throw error;
    }
  };
}
