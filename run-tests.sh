#!/usr/bin/env bash
# Build, run shared unit tests, then run the WebView isolation tests on the
# connected emulator/device and copy results to ./results/android.
# With more than one device, pick one: ANDROID_SERIAL=emulator-5554 ./run-tests.sh
set -euo pipefail
cd "$(dirname "$0")"

PKG=dev.truapi.playground
RES=results/android

./gradlew --console=plain :shared:testDebugUnitTest :androidApp:assembleDebug :androidApp:assembleDebugAndroidTest

adb wait-for-device
adb install -r androidApp/build/outputs/apk/debug/androidApp-debug.apk >/dev/null
adb install -r androidApp/build/outputs/apk/androidTest/debug/androidApp-debug-androidTest.apk >/dev/null
adb shell rm -rf "/sdcard/Android/data/$PKG/files/results"

rm -rf "$RES"
mkdir -p "$RES"
{
  echo "android=$(adb shell getprop ro.build.version.release) sdk=$(adb shell getprop ro.build.version.sdk) model=$(adb shell getprop ro.product.model)"
  adb shell dumpsys webviewupdate | grep -m1 'Current WebView package'
} | tee "$RES/device.txt"

adb logcat -c
set +e
adb shell am instrument -w -r "$PKG.test/androidx.test.runner.AndroidJUnitRunner" | tee "$RES/instrument.txt"
set -e
adb logcat -d -s TRUAPI:I > "$RES/logcat.txt"
adb pull "/sdcard/Android/data/$PKG/files/results/." "$RES/" >/dev/null

echo
cat "$RES"/*.verdict.txt
grep -q "^OK (" "$RES/instrument.txt"
