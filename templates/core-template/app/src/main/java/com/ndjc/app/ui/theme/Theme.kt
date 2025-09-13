package com.ndjc.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

enum class ThemeMode { SYSTEM, LIGHT, DARK }

@Composable
fun AppTheme(
  themeMode: ThemeMode = ThemeMode.SYSTEM,
  dynamicColor: Boolean = true,
  content: @Composable () -> Unit
) {
  val context = LocalContext.current
  val dark = when (themeMode) {
    ThemeMode.SYSTEM -> isSystemInDarkTheme()
    ThemeMode.LIGHT  -> false
    ThemeMode.DARK   -> true
  }

  val scheme =
    if (dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    } else {
      if (dark) darkColorScheme(primary = DarkPrimary, secondary = BrandSecondary, tertiary = BrandAccent)
      else lightColorScheme(primary = LightPrimary, secondary = BrandSecondary, tertiary = BrandAccent)
    }

  MaterialTheme(colorScheme = scheme, shapes = AppShapes, content = content)
}
