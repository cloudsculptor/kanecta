#!/bin/bash
# Run this once to generate your signing keystore.
# KEEP THE RESULTING FILE SAFE — if you lose it you cannot update the app on Google Play.
# Store it somewhere secure (password manager, encrypted backup) — NOT in git.

keytool -genkey -v \
  -keystore featherston-release.keystore \
  -alias featherston \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=Featherston Community Hub, OU=, O=, L=Featherston, S=Wellington, C=NZ"
