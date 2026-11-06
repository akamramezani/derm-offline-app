# Derm differential engine - offline Android app

A tiny app (one screen, no libraries, no INTERNET permission) that shows the offline copy of the
dermatology differential engine stored in `app/src/main/assets/derm/`.

* The page is answered from the app's own files; nothing is ever loaded from the network.
* The scoring engine is `derm-engine.js` inside that folder, rebuilt from the live engine's answers.
* GitHub builds the debug APK automatically (`.github/workflows/build-apk.yml`); see the repo's
  Releases page ("Latest debug build") or the run's Artifacts.

To update the content, replace everything inside `app/src/main/assets/derm/` and commit: the APK rebuilds itself.

## Installing and updating
* The APK is signed with the fixed, public debug key in `app/debug.keystore`, so every new build installs over the
  previous one (it is a debug key: fine for your own phone, not for the Play Store).
* On the phone you may have to allow "install unknown apps" for the browser you download with.
