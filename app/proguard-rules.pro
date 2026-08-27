# TERRA release shrink rules.
# Room, DataStore and Compose ship consumer rules; app-specific keeps below.

-keep class com.terra.kensyuu.data.db.entity.** { *; }
-keepattributes *Annotation*

# Google API client uses reflection for JSON (de)serialization.
-keep class com.google.api.services.drive.** { *; }
-keep class com.google.api.client.** { *; }
-dontwarn com.google.api.client.**
-dontwarn org.apache.http.**
