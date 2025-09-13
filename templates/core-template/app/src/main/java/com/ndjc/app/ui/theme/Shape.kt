package com.ndjc.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

// 这里不要再定义 NDJC_CORNER_RADIUS_DP 了！只使用 Dimens.kt 中的常量
val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small      = RoundedCornerShape(NDJC_CORNER_RADIUS_DP.dp),
    medium     = RoundedCornerShape(NDJC_CORNER_RADIUS_DP.dp),
    large      = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp)
)
