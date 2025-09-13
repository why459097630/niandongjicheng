package com.ndjc.app.ui.theme

import androidx.compose.ui.graphics.Color
import android.graphics.Color as AColor

val BrandPrimary   = Color(AColor.parseColor("{{NDJC_PRIMARY_COLOR}}"))
val BrandSecondary = Color(AColor.parseColor("{{NDJC_SECONDARY_COLOR}}"))
val BrandAccent    = Color(AColor.parseColor("{{NDJC_ACCENT_COLOR}}"))

val LightPrimary = BrandPrimary
val DarkPrimary  = BrandPrimary
