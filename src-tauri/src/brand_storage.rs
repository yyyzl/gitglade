use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

static MIGRATION_SERIAL: AtomicU64 = AtomicU64::new(0);

/// Copy legacy records once, leaving both an existing destination and the
/// original file untouched. Publish a complete file without an overwrite race.
pub(crate) fn migrate_recent_file(legacy: &Path, current: &Path) -> io::Result<()> {
    match fs::symlink_metadata(current) {
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let bytes = match fs::read(legacy) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let parent = current.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "Missing recent file directory")
    })?;
    fs::create_dir_all(parent)?;
    let (temporary, mut file) = loop {
        let serial = MIGRATION_SERIAL.fetch_add(1, Ordering::Relaxed);
        let temporary = parent.join(format!(
            ".recent-migration-{}-{serial}.tmp",
            std::process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => break (temporary, file),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    };
    let result = (|| {
        file.write_all(&bytes)?;
        file.sync_all()?;
        // Unlike rename/copy, hard_link never replaces an existing destination.
        match fs::hard_link(&temporary, current) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error),
        }
    })();
    drop(file);
    let _ = fs::remove_file(temporary);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn migration_copies_original_bytes_once_without_removing_the_legacy_file() {
        let directory = tempdir().unwrap();
        let legacy = directory.path().join("org.oiloil.oilgit/recent.json");
        let current = directory
            .path()
            .join("io.github.yyyzl.gitglade/recent.json");
        let original = br#"[{"path":"/a project","name":"a project"}]"#;
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&legacy, original).unwrap();

        migrate_recent_file(&legacy, &current).unwrap();
        assert_eq!(fs::read(&current).unwrap(), original);
        assert_eq!(fs::read(&legacy).unwrap(), original);
        fs::write(&legacy, b"changed legacy records").unwrap();
        migrate_recent_file(&legacy, &current).unwrap();
        assert_eq!(fs::read(&current).unwrap(), original);
        assert_eq!(fs::read_dir(current.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn migration_never_overwrites_existing_new_records_including_empty_files() {
        for existing in [b"[]".as_slice(), b"".as_slice()] {
            let directory = tempdir().unwrap();
            let legacy = directory.path().join("legacy.json");
            let current = directory.path().join("recent.json");
            fs::write(&legacy, b"old records").unwrap();
            fs::write(&current, existing).unwrap();
            migrate_recent_file(&legacy, &current).unwrap();
            assert_eq!(fs::read(&current).unwrap(), existing);
            assert_eq!(fs::read(&legacy).unwrap(), b"old records");
        }
    }

    #[test]
    fn migration_leaves_missing_legacy_records_alone() {
        let directory = tempdir().unwrap();
        let current = directory.path().join("new/recent.json");
        migrate_recent_file(&directory.path().join("legacy/recent.json"), &current).unwrap();
        assert!(!current.exists());
        assert!(!current.parent().unwrap().exists());
    }

    #[test]
    fn migration_failure_preserves_the_legacy_file() {
        let directory = tempdir().unwrap();
        let legacy = directory.path().join("legacy.json");
        let blocker = directory.path().join("not-a-directory");
        fs::write(&legacy, b"original").unwrap();
        fs::write(&blocker, b"untouched").unwrap();
        assert!(migrate_recent_file(&legacy, &blocker.join("recent.json")).is_err());
        assert_eq!(fs::read(&legacy).unwrap(), b"original");
        assert_eq!(fs::read(&blocker).unwrap(), b"untouched");
    }

    #[test]
    fn concurrent_migrations_publish_one_complete_copy() {
        let directory = tempdir().unwrap();
        let legacy = directory.path().join("legacy.json");
        let current = directory.path().join("new/recent.json");
        let bytes = vec![b'x'; 65536];
        fs::write(&legacy, &bytes).unwrap();
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let legacy = &legacy;
                let current = &current;
                scope.spawn(move || migrate_recent_file(legacy, current).unwrap());
            }
        });
        assert_eq!(fs::read(&current).unwrap(), bytes);
        assert_eq!(fs::read(&legacy).unwrap(), bytes);
        assert_eq!(fs::read_dir(current.parent().unwrap()).unwrap().count(), 1);
    }
}
