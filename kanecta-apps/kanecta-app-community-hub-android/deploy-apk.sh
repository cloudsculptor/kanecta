#!/bin/bash
set -e

APK="android/app/release/app-release.apk"

if [ ! -f "$APK" ]; then
  echo "Error: $APK not found. Build a release APK in Android Studio first."
  exit 1
fi

echo "Uploading $APK to app.featherston.co.nz..."
scp "$APK" remutaka:/var/www/app.featherston/featherston.apk
echo "Done. https://app.featherston.co.nz"
