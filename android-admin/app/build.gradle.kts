plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/*
 * ScreenTinker Manager (android-admin/): the Simple view of a ScreenTinker server in a WebView,
 * with phone-native extras (server picker, photo picker, Share from the Gallery, Advanced in the
 * browser). The player app is a separate project (android/, com.remotedisplay.player).
 *
 * targetSdk 36: Google Play requires new apps to target the latest major Android release.
 * Release signing reads the same kind of env/properties the player's build does, so a CI job can
 * sign without the keystore ever being committed.
 */
android {
    namespace = "com.screentinker.manager"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.screentinker.manager"
        minSdk = 26
        targetSdk = 36
        versionCode = (System.getenv("VERSION_CODE") ?: findProperty("VERSION_CODE") as String? ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: findProperty("VERSION_NAME") as String? ?: "1.0.0"
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("MANAGER_KEYSTORE") ?: findProperty("MANAGER_KEYSTORE") as String?
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("MANAGER_KEYSTORE_PASSWORD") ?: findProperty("MANAGER_KEYSTORE_PASSWORD") as String?
                keyAlias = System.getenv("MANAGER_KEY_ALIAS") ?: findProperty("MANAGER_KEY_ALIAS") as String?
                keyPassword = System.getenv("MANAGER_KEY_PASSWORD") ?: findProperty("MANAGER_KEY_PASSWORD") as String?
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            val release = signingConfigs.getByName("release")
            if (release.storeFile != null) signingConfig = release
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.browser:browser:1.8.0")
}
