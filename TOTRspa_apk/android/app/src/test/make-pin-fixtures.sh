#!/bin/sh
# Makes the public test certificates for PinsTest in resources/pins/. Run it again only if the files must change (the test's expected fingerprint then changes too).
# Two throwaway authorities shaped like TOTR's own (TOTRsrv/tools/make_certs.py: CA:TRUE pathlen:0, name-constrained to private addresses and .local/.lan) and the server
# certificates they sign. Every private key is deleted at the end: only certificates are kept.
set -eu
out=$(cd "$(dirname "$0")" && pwd)/resources/pins
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
cd "$t"
mkca() { # $1 = file stem, $2 = days, $3 = constraints section
  cat >"$1.cnf" <<CNF
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = Test CA $1
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
$3
CNF
  openssl ecparam -name prime256v1 -genkey -noout -out "$1.key"
  openssl req -new -x509 -key "$1.key" -days "$2" -config "$1.cnf" -out "$1.pem"
}
CONSTRAINED="nameConstraints = critical, @names
[names]
permitted;IP.0 = 10.0.0.0/255.0.0.0
permitted;IP.1 = 192.168.0.0/255.255.0.0
permitted;IP.2 = 172.16.0.0/255.240.0.0
permitted;DNS.0 = .local
permitted;DNS.1 = .lan"
mkca ca 36500 "$CONSTRAINED"
mkca other-ca 36500 "$CONSTRAINED"
mkleaf() { # $1 = stem, $2 = signing authority stem, $3 = days, $4 = subjectAltName
  openssl ecparam -name prime256v1 -genkey -noout -out "$1.key"
  openssl req -new -key "$1.key" -subj "/CN=$1" -out "$1.csr"
  printf 'basicConstraints = CA:FALSE\nkeyUsage = digitalSignature\nextendedKeyUsage = serverAuth\nsubjectAltName = %s\n' "$4" >"$1.ext"
  openssl x509 -req -in "$1.csr" -CA "$2.pem" -CAkey "$2.key" -CAcreateserial -days "$3" -extfile "$1.ext" -out "$1.pem" 2>/dev/null
}
mkleaf server ca 3650 "IP:10.0.0.50,DNS:box.local"
mkleaf server-other other-ca 3650 "IP:10.0.0.50,DNS:box.local"
mkleaf server-public ca 3650 "IP:8.8.8.8,DNS:example.com" # signed by an authority that is not allowed to vouch for these: a broken authority
# names right at the edges of what is private (the authority signs them all; the app's own rule decides)
mkleaf server-172in ca 3650 "IP:172.31.255.1"
mkleaf server-172out ca 3650 "IP:172.32.0.1"
mkleaf server-192out ca 3650 "IP:192.0.2.5"           # 192.x but not 192.168.x
mkleaf server-mixed ca 3650 "IP:10.0.0.50,IP:8.8.8.8" # one private name and one public name on the same certificate
mkleaf server-lan ca 3650 "DNS:nas.lan"
mkleaf server-email ca 3650 "IP:10.0.0.50,email:a@example.com" # a kind of name TOTR never issues
mkleaf server-bare ca 3650 "DNS:local"                         # not ending in .local
for f in ca other-ca server server-other server-public server-172in server-172out server-192out server-mixed server-lan server-bare server-email; do cp "$f.pem" "$out/$f.pem"; done
echo "made: $(cd "$out" && printf '%s ' *)"
