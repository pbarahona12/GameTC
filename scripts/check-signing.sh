#!/usr/bin/env bash
# Comprueba la firma de una APK o un AAB antes de distribuirlo.
#
#   scripts/check-signing.sh <archivo.apk|archivo.aab>
#
# Falla si el archivo no está firmado, si lo firma una llave de depuración
# (CN=Android Debug) o si el certificado figura en android/compromised-signing-certs.txt
# (por ejemplo, la llave pública que estuvo en el repositorio hasta la 1.4.0).
# Para APK usa apksigner (variable APKSIGNER o el del PATH); para AAB, keytool.
set -euo pipefail

file="${1:?uso: scripts/check-signing.sh <archivo.apk|archivo.aab>}"
deny="$(cd "$(dirname "$0")/.." && pwd)/android/compromised-signing-certs.txt"

case "$file" in
  *.apk)
    out="$("${APKSIGNER:-apksigner}" verify --print-certs "$file")"
    certs="$(printf '%s\n' "$out" | sed -n 's/.*certificate SHA-256 digest: //p' | tr 'A-F' 'a-f')"
    subjects="$(printf '%s\n' "$out" | sed -n 's/.*certificate DN: //p')"
    ;;
  *.aab|*.jar)
    out="$(keytool -printcert -jarfile "$file")"
    certs="$(printf '%s\n' "$out" | sed -n 's/.*SHA256: //p' | tr -d ': ' | tr 'A-F' 'a-f')"
    subjects="$(printf '%s\n' "$out" | sed -n 's/^Owner: //p')"
    ;;
  *)
    echo "check-signing: tipo de archivo no soportado: $file" >&2
    exit 2
    ;;
esac

if [ -z "$certs" ]; then
  echo "::error::$file no está firmado." >&2
  exit 1
fi
for c in $certs; do
  if grep -v '^#' "$deny" | grep -qix "$c"; then
    echo "::error::$file está firmado con un certificado COMPROMETIDO ($c). Ver android/compromised-signing-certs.txt." >&2
    exit 1
  fi
done
if printf '%s\n' "$subjects" | grep -q "CN=Android Debug"; then
  echo "::error::$file está firmado con una llave de depuración: no se distribuye." >&2
  exit 1
fi
echo "Firma de $file aceptada: $(printf '%s ' $certs)"
