# FX-02 — backfill branches on existing records

Production run: **Mon 28 Sep 2026**, as part of the Release 1 deploy (FX-14).
Covers FX-02.1 – FX-02.4. Run everything on the production server, as the
`ubuntu` user, from the app checkout:

```bash
cd /home/ubuntu/app
export PATH="$HOME/.bun/bin:$PATH"
```

MongoDB runs on the same box (`127.0.0.1:27017`, database `fitflix`).

## 0. Before you start

- [ ] Release 1 (which includes FX-01) is deployed to `/home/ubuntu/app` and
      `fitflix-backend.service` has been restarted. **Deploy first:** anything
      created between the backfill and the deploy would otherwise have no branch.
- [ ] `mongodump --version` and `mongorestore --version` work. If not:
      `sudo apt-get install -y mongodb-database-tools`.
- [ ] Free disk space is at least 3× the database size:
      `df -h /home/ubuntu` and `mongosh fitflix --quiet --eval 'db.stats(1024*1024).dataSize'` (MB).

## 1. Back up (FX-02.3)

```bash
mkdir -p ~/backups
ARCHIVE=~/backups/fitflix-$(date +%F-%H%M)-pre-fx02.archive.gz
mongodump --db fitflix --archive="$ARCHIVE" --gzip
ls -lh "$ARCHIVE"
```

## 2. Prove the backup restores (FX-02.3)

Restore into a separate database. Never use `--drop` on `fitflix` here.

```bash
mongorestore --archive="$ARCHIVE" --gzip \
  --nsFrom='fitflix.*' --nsTo='fitflix_restore_check.*'

# Every collection must have the same count in both.
mongosh --quiet --eval '
  const a = db.getSiblingDB("fitflix"), b = db.getSiblingDB("fitflix_restore_check");
  let bad = 0;
  a.getCollectionNames().forEach(c => {
    const x = a[c].estimatedDocumentCount(), y = b[c].estimatedDocumentCount();
    if (x !== y) { bad++; print("MISMATCH", c, x, y); }
  });
  print(bad ? bad + " collections differ" : "restore matches");'
```

- [ ] Output is `restore matches`.

## 3. Rehearse on the copy (FX-02.1, FX-02.2)

```bash
COPY=mongodb://127.0.0.1:27017/fitflix_restore_check
MONGODB_URL=$COPY bun run backfill:branches            # dry run: read the counts
MONGODB_URL=$COPY bun run backfill:branches -- --apply
MONGODB_URL=$COPY bun run backfill:branches -- --apply # must write 0
MONGODB_URL=$COPY bun run check:missing-branch         # must exit 0
```

- [ ] The dry run shows one default branch (Sainikpuri) and `unresolved` 0 for every kind.
- [ ] The second `--apply` reports `written` 0 for every kind.
- [ ] `check:missing-branch` prints `Every record has a branch.`

Save the output of all four commands to attach to FX-02 in ClickUp.

## 4. Production (FX-02.4)

`.env` in `/home/ubuntu/app` points at production, so no `MONGODB_URL` is needed:

```bash
bun run backfill:branches             # dry run — counts should match step 3
bun run backfill:branches -- --apply
bun run check:missing-branch          # must exit 0
```

- [ ] `check:missing-branch` prints `Every record has a branch.`

## 5. Clean up

```bash
mongosh --quiet --eval 'db.getSiblingDB("fitflix_restore_check").dropDatabase()'
```

Keep the archive for at least two weeks.

## If something goes wrong

The backfill only fills **empty** branch fields. It never changes one that is
already set, and nothing reads these fields yet except branch filters that
nobody sends while there is one branch. A partial run is therefore harmless:
fix the cause and run `--apply` again.

Restoring the archive over production (`mongorestore --drop`) would also throw
away everything written since step 1. Only do that on the owner's say-so.
