use super::*;
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use rand::RngCore;
use zeroize::Zeroizing;
const MAGIC: &[u8] = b"MFLOCK1\0";
pub struct Unlocked {
    pub key: Zeroizing<[u8; 32]>,
}
pub fn locked(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}
fn derive(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    let mut key = Zeroizing::new([0u8; 32]);
    argon2::Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut *key)
        .map_err(|_| AppError::new("LOCK", "无法计算密码密钥"))?;
    Ok(key)
}
pub fn decrypt(bytes: &[u8], key: &[u8; 32]) -> Result<Zeroizing<Vec<u8>>> {
    if bytes.len() < 52 || !locked(bytes) {
        return Err(AppError::new("LOCK", "加密文件格式无效"));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AppError::new("LOCK", "密钥无效"))?;
    cipher
        .decrypt(Nonce::from_slice(&bytes[24..36]), &bytes[36..])
        .map(Zeroizing::new)
        .map_err(|_| AppError::new("PASSWORD", "密码错误或文件已损坏"))
}
pub fn encrypt(bytes: &[u8], key: &[u8; 32], salt: &[u8]) -> Result<Vec<u8>> {
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AppError::new("LOCK", "密钥无效"))?;
    let data = cipher
        .encrypt(Nonce::from_slice(&nonce), bytes)
        .map_err(|_| AppError::new("LOCK", "加密失败"))?;
    let mut result = MAGIC.to_vec();
    result.extend_from_slice(salt);
    result.extend_from_slice(&nonce);
    result.extend(data);
    Ok(result)
}
impl Library {
    pub fn decode_locked(&self, id: &str, path: &str, bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        let unlocked = self
            .unlocked
            .lock()
            .map_err(|_| AppError::new("LOCK", "解锁状态不可用"))?;
        let key = unlocked
            .get(&format!("{id}:{path}"))
            .ok_or_else(|| AppError::new("LOCKED", "此笔记已加密，请先解锁"))?;
        decrypt(bytes, &key.key)
    }
    pub fn encode_locked(
        &self,
        id: &str,
        path: &str,
        bytes: &[u8],
        original: &[u8],
    ) -> Result<Vec<u8>> {
        if original.len() < 52 {
            return Err(AppError::new("LOCK", "加密文件格式无效"));
        }
        let unlocked = self
            .unlocked
            .lock()
            .map_err(|_| AppError::new("LOCK", "解锁状态不可用"))?;
        let key = unlocked
            .get(&format!("{id}:{path}"))
            .ok_or_else(|| AppError::new("LOCKED", "此笔记已锁定"))?;
        encrypt(bytes, &key.key, &original[8..24])
    }
    pub fn lock_action(
        &mut self,
        id: &str,
        path: &str,
        action: &str,
        password: String,
        expected_version: Option<&str>,
    ) -> Result<String> {
        let password = Zeroizing::new(password);
        if action == "close" {
            self.unlocked
                .lock()
                .map_err(|_| AppError::new("LOCK", "解锁状态不可用"))?
                .remove(&format!("{id}:{path}"));
            return Ok(path.into());
        }
        let selected = self.root(id)?.join(checked_relative(path)?);
        if fs::symlink_metadata(&selected)?.file_type().is_symlink() {
            return Err(AppError::new("PATH", "请直接选择笔记文件进行加密操作"));
        }
        let file = self.resolve(id, path, true)?;
        if !file.is_file() || fs::metadata(&file)?.len() > MAX_DOCUMENT {
            return Err(AppError::new("LARGE", "请选择不超过 16 MB 的笔记文件"));
        }
        if password.len() > 1024 {
            return Err(AppError::new("PASSWORD", "密码长度超过限制"));
        }
        let bytes = Zeroizing::new(fs::read(&file)?);
        if expected_version.is_some_and(|expected| expected != version(&bytes)) {
            return Err(AppError::new("CONFLICT", "笔记已被修改，请重新加载后操作"));
        }
        if action == "unlock" {
            if bytes.len() < 52 || !locked(&bytes) {
                return Err(AppError::new("LOCK", "请选择加密笔记"));
            }
            let key = derive(&password, &bytes[8..24])?;
            let _verified = decrypt(&bytes, &key)?;
            self.unlocked
                .lock()
                .map_err(|_| AppError::new("LOCK", "解锁状态不可用"))?
                .insert(format!("{id}:{path}"), Unlocked { key });
            return Ok(path.into());
        }
        if action == "decrypt" {
            let clear = self.decode_locked(id, path, &bytes)?;
            let target = path
                .strip_suffix(".mflock")
                .ok_or_else(|| AppError::new("LOCK", "加密文件名称无效"))?;
            let destination = self.resolve(id, target, false)?;
            if destination.exists() {
                return Err(AppError::new("EXISTS", "原文件名已存在"));
            }
            replace_format(&file, &destination, &clear, &version(&bytes))?;
            self.mark_changed(id, path);
            self.mark_changed(id, target);
            self.unlocked
                .lock()
                .map_err(|_| AppError::new("LOCK", "解锁状态不可用"))?
                .remove(&format!("{id}:{path}"));
            return Ok(target.into());
        }
        if action != "lock" || locked(&bytes) {
            return Err(AppError::new("LOCK", "加密操作无效"));
        }
        if password.len() < 8 || password.len() > 1024 {
            return Err(AppError::new("PASSWORD", "密码至少 8 个字符"));
        }
        let target = format!("{path}.mflock");
        let destination = self.resolve(id, &target, false)?;
        if destination.exists() {
            return Err(AppError::new("EXISTS", "加密文件已存在"));
        }
        let mut salt = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut salt);
        let key = derive(&password, &salt)?;
        let encrypted = encrypt(&bytes, &key, &salt)?;
        let verified = decrypt(&encrypted, &key)?;
        if *verified != *bytes {
            return Err(AppError::new("LOCK", "加密校验失败"));
        }
        index::purge(self, id, path)?;
        replace_format(&file, &destination, &encrypted, &version(&bytes))?;
        self.mark_changed(id, path);
        self.mark_changed(id, &target);
        Ok(target)
    }
}
fn replace_format(source: &Path, destination: &Path, bytes: &[u8], expected: &str) -> Result<()> {
    if fs::symlink_metadata(source)?.file_type().is_symlink() {
        return Err(AppError::new("PATH", "请直接选择笔记文件进行加密操作"));
    }
    let mut out = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let result = (|| {
        out.set_permissions(fs::metadata(source)?.permissions())?;
        out.write_all(bytes)?;
        out.sync_all()?;
        if version(&fs::read(source)?) != expected {
            return Err(AppError::new("CONFLICT", "加密操作期间笔记被外部修改"));
        }
        fs::remove_file(source)?;
        Ok(())
    })();
    drop(out);
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encryption_authenticates_password_and_tampering() {
        let salt = [7u8; 16];
        let key = derive("correct password", &salt).unwrap();
        let bytes = encrypt(b"private markdown", &key, &salt).unwrap();
        assert_eq!(&**decrypt(&bytes, &key).unwrap(), b"private markdown");
        let wrong = derive("wrong password", &salt).unwrap();
        assert!(decrypt(&bytes, &wrong).is_err());
        let mut corrupt = bytes.clone();
        corrupt[40] ^= 1;
        assert!(decrypt(&corrupt, &key).is_err());
    }
}
