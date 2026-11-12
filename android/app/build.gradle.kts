import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "at.hafner.gruenraum"
    compileSdk = 35

    defaultConfig {
        applicationId = "at.hafner.gruenraum"
        minSdk = 31
        targetSdk = 35
        versionCode = 2
        versionName = "1.1.0"

        val defaultMcpUrl = (System.getenv("MCP_SERVER_URL") ?: "https://ais-pre-usuarrctzvo6yzyghmhedg-947976408951.europe-west2.run.app")
            .trim()
            .replace("\"", "")

        // Nur die Serveradresse wird in der APK hinterlegt – niemals ein dauerhafter Admin- oder Sync-Schlüssel.
        buildConfigField("String", "DEFAULT_MCP_BASE_URL", "\"$defaultMcpUrl\"")

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("KEYSTORE_PATH")
            if (!keystorePath.isNullOrBlank() && File(keystorePath).exists()) {
                storeFile = File(keystorePath)
                storePassword = System.getenv("KEYSTORE_PASSWORD") ?: "hafner2026"
                keyAlias = System.getenv("KEY_ALIAS") ?: "hafner_key"
                keyPassword = System.getenv("KEY_PASSWORD") ?: "hafner2026"
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            val releaseSigning = signingConfigs.findByName("release")
            signingConfig = if (releaseSigning?.storeFile != null) {
                releaseSigning
            } else {
                signingConfigs.getByName("debug")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
}
