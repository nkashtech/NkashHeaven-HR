#!/bin/sh
# A private MySQL for this project on port 3317, so it needs no password on your main server.
# The data lives in backend/mysql-data (gitignored; InnoDB skips hidden folders, so no leading dot). Run: npm run db:local
cd "$(dirname "$0")/.." || exit 1
DATA="$PWD/mysql-data"
if [ ! -d "$DATA" ]; then
  mysqld --initialize-insecure --datadir="$DATA" || exit 1
fi
mysqld --datadir="$DATA" --port=3317 --socket=/tmp/nkash-mysql.sock --mysqlx=OFF --bind-address=127.0.0.1 --pid-file="$DATA/mysqld.pid" &
PID=$!
trap 'kill $PID' INT TERM
until mysql -uroot -h127.0.0.1 -P3317 -e "CREATE DATABASE IF NOT EXISTS nkash_hr CHARACTER SET utf8mb4; CREATE DATABASE IF NOT EXISTS nkash_hr_test CHARACTER SET utf8mb4" 2>/dev/null; do
  sleep 1
done
echo "MySQL ready on 127.0.0.1:3317"
wait $PID
