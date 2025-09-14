// app/src/main/java/com/ndjc/app/data/ThemePrefs.kt
package com.ndjc.app.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private const val PREF_NAME = "settings"

// 在 Context 上扩展一个 DataStore<Preferences>
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(
    name = PREF_NAME
)

object ThemePrefs {
    private val KEY_DARK_MODE = booleanPreferencesKey("dark_mode")

    /** 读取暗色模式开关（默认 false） */
    fun isDarkMode(context: Context): Flow<Boolean> =
        context.dataStore.data.map { prefs -> prefs[KEY_DARK_MODE] ?: false }

    /** 保存暗色模式开关 */
    suspend fun setDarkMode(context: Context, value: Boolean) {
        context.dataStore.edit { prefs ->
            prefs[KEY_DARK_MODE] = value
        }
    }
}
