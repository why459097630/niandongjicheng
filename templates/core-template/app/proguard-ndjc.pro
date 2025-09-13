#####################################################################
# NDJC 追加混淆规则（安全默认）
# 目的：保证入口组件、Compose 运行时、序列化与常用反射安全
#####################################################################

# 1) 保留入口（Activity/Service/Receiver/Provider）
-keep class ** extends android.app.Activity
-keep class ** extends android.app.Service
-keep class ** extends android.content.BroadcastReceiver
-keep class ** extends android.content.ContentProvider

# 2) Parcelable（保留 CREATOR）
-keep class * implements android.os.Parcelable {
  public static final android.os.Parcelable$Creator *;
}

# 3) 资源类（避免 R 被清）
-keep class **.R$* { *; }

# 4) Jetpack Compose（常用保留；按需裁剪）
-keep class androidx.compose.** { *; }
-keep class androidx.activity.compose.** { *; }
-keep class androidx.lifecycle.** { *; }
-keepclassmembers class * {
    @androidx.compose.runtime.Composable <methods>;
}

# 5) Kotlin 反射/协程 & 常见库
-dontwarn kotlin.**
-dontwarn kotlinx.coroutines.**
-dontwarn androidx.**
-dontwarn com.google.**

# 6) kotlinx.serialization（如果用到）
-keep @kotlinx.serialization.Serializable class * { *; }
-keep class kotlinx.serialization.** { *; }

# 7) (可选) 保留标注了 @Keep 的类/成员
-keep @androidx.annotation.Keep class * { *; }
-keepclassmembers class * {
    @androidx.annotation.Keep *;
}

# 8) (可选) 你自己的公共 API（按需指定包名）
# -keep class com.ndjc.** { *; }

#####################################################################
# 注意：
#   - 默认不关闭压缩/优化：由 app/build.gradle 的 minifyEnabled 控制
#   - 这里尽量不使用全局 -dontoptimize/-dontobfuscate，避免失去 R8 价值
#####################################################################
