# Featherston Community Hub — Android App

Android wrapper for [featherston.co.nz](https://featherston.co.nz) built with Capacitor.

The app loads the live website via WebView — no bundled web assets.
Updates to the site are immediately available in the app without a Play Store release.

**App ID:** `nz.co.featherston`  
**Min Android:** 6.0 (API 23)

## First-time setup

You need [Android Studio](https://developer.android.com/studio) installed.

```bash
npm install
npx cap open android   # opens Android Studio
```

## Keystore (signing)

You need a keystore to sign release builds for Google Play.
Run this **once**, then keep the file somewhere safe — NOT in git.

```bash
bash generate-keystore.sh
```

You'll be prompted for a password. Store that password securely.

Then add to `android/app/build.gradle` under `android { ... }`:

```groovy
signingConfigs {
    release {
        storeFile file("../../featherston-release.keystore")
        storePassword "YOUR_PASSWORD"
        keyAlias "featherston"
        keyPassword "YOUR_PASSWORD"
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

## Building a release APK / AAB

In Android Studio: **Build → Generate Signed Bundle / APK**

Or from the command line (after keystore is configured):

```bash
cd android
./gradlew bundleRelease   # produces .aab for Play Store
./gradlew assembleRelease # produces .apk for sideloading
```

Output: `android/app/build/outputs/`

## Updating native plugins

```bash
npm install
npx cap sync android
```

## Native plugins included

| Plugin | Purpose |
|---|---|
| `@capacitor/status-bar` | Dark green status bar matching the site header |
| `@capacitor/splash-screen` | Splash screen while WebView loads |
| `@capacitor/browser` | Opens external links in system browser |
