package com.ndjc.app.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import com.ndjc.app.ui.theme.ThemeMode

private val Context.dataStore by preferencesDataStore(name = "ui_prefs")
object ThemeKeys {
  val MODE = intPreferencesKey("theme_mode")      // 0=SYSTEM 1=LIGHT 2=DARK
  val DYNAMIC = booleanPreferencesKey("dynamic")  // 动态色开关
}
class ThemePrefs(private val context: Context) {
  val themeMode: Flow<ThemeMode> = context.dataStore.data.map {
    when (it[ThemeKeys.MODE] ?: modeFromDefault()) {
      1 -> ThemeMode.LIGHT
      2 -> ThemeMode.DARK
      else -> ThemeMode.SYSTEM
    }
  }
  val dynamicColor: Flow<Boolean> = context.dataStore.data.map {
    it[ThemeKeys.DYNAMIC] ?: true
  }
  suspend fun setThemeMode(mode: ThemeMode) {
    context.dataStore.edit {
      it[ThemeKeys.MODE] = when (mode) {
        ThemeMode.SYSTEM -> 0
        ThemeMode.LIGHT  -> 1
        ThemeMode.DARK   -> 2
      }
    }
  }
  suspend fun setDynamicColor(enabled: Boolean) {
    context.dataStore.edit { it[ThemeKeys.DYNAMIC] = enabled }
  }
  private fun modeFromDefault(): Int =
    when ("{{NDJC_THEME_MODE}}".lowercase()) {
      "light" -> 1
      "dark"  -> 2
      else    -> 0
    }
}
