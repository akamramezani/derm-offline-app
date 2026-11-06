plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.medconsults.dermoffline"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.medconsults.dermoffline"
        minSdk = 26
        targetSdk = 34
        // every GitHub build gets a higher number, so a new APK installs over the previous one
        versionCode = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = "1.0"
    }

    // One fixed debug key (committed on purpose; it is the public, password-"android" debug key). Without it each
    // GitHub build would be signed with a new random key and Android would refuse to update the installed app.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
// No dependencies on purpose: the page is served from the app's own assets with plain Android classes.
