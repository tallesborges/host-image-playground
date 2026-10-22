#!/usr/bin/env bash
# Build the iOS app (Xcode runs Gradle for Shared.framework), run the WKWebView isolation
# tests on a simulator, and copy results to ./results/ios.
# Pick the simulator: IOS_SIMULATOR="iPhone 17" ./run-ios-tests.sh  (or a UDID)
set -euo pipefail
cd "$(dirname "$0")"

SIM="${IOS_SIMULATOR:-iPhone 17}"
BUNDLE=dev.truapi.playground
RES=results/ios
DERIVED=iosApp/build/DerivedData

UDID=$(xcrun simctl list devices available -j | jq -r --arg s "$SIM" \
  '[.devices[][] | select(.udid == $s or .name == $s)][0].udid // empty')
[ -n "$UDID" ] || { echo "no available simulator named or with UDID: $SIM"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null

./gradlew --console=plain -q :shared:iosSimulatorArm64Test

DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data 2>/dev/null || true)
[ -n "$DATA" ] && rm -rf "$DATA/Documents/results"

rm -rf "$RES" iosApp/build/TestResults.xcresult
mkdir -p "$RES"
set +e
xcodebuild -project iosApp/iosApp.xcodeproj -scheme iosApp \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$DERIVED" \
  -resultBundlePath iosApp/build/TestResults.xcresult test > "$RES/xcodebuild.log" 2>&1
status=$?
set -e

xcrun simctl list devices -j | jq -r --arg u "$UDID" \
  '.devices | to_entries[] | .key as $rt | .value[] | select(.udid == $u) | "simulator=\(.name) runtime=\($rt)"' \
  | tee "$RES/device.txt"
xcodebuild -version | tr '\n' ' ' | tee -a "$RES/device.txt"; echo | tee -a "$RES/device.txt"

DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
cp "$DATA"/Documents/results/* "$RES/"
# The file:// scenario records local paths; keep them out of the shared results.
sed -i '' -e "s#$HOME#~#g" -e "s#$UDID#<simulator>#g" "$RES"/*.jsonl "$RES"/*.verdict.txt
grep -E "TRUAPI (SCENARIO|PRODUCT|REQ|BEACON|VERDICT|PROBLEM)" "$RES/xcodebuild.log" | sed -E 's/^.*TRUAPI /TRUAPI /' > "$RES/host.log" || true

echo
grep -E "^Test Case .*(passed|failed)|\*\* TEST" "$RES/xcodebuild.log" || true
echo
cat "$RES"/*.verdict.txt | grep -v '^meta='
exit $status
