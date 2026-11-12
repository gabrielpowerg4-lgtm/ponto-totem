package br.com.pontototem.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Cores com significado fixo, fora do esquema do Material. */
data class StatusColors(val success: Color, val warning: Color, val subtle: Color)

val LocalStatusColors = staticCompositionLocalOf {
    StatusColors(Color(0xFF15803D), Color(0xFFB45309), Color(0xFFF0F0EC))
}

private val LightColors = lightColorScheme(
    primary = Color(0xFF0F766E),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD5EFEB),
    onPrimaryContainer = Color(0xFF07403B),
    background = Color(0xFFF6F6F3),
    onBackground = Color(0xFF16181A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF16181A),
    surfaceVariant = Color(0xFFEDEDE8),
    onSurfaceVariant = Color(0xFF5C6166),
    outline = Color(0xFFD4D4CE),
    outlineVariant = Color(0xFFE4E4DE),
    error = Color(0xFFB42318),
    onError = Color(0xFFFFFFFF)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF3FCFBF),
    onPrimary = Color(0xFF04201D),
    primaryContainer = Color(0xFF103B37),
    onPrimaryContainer = Color(0xFFBDEFE8),
    background = Color(0xFF0D0F11),
    onBackground = Color(0xFFECEEEF),
    surface = Color(0xFF16191C),
    onSurface = Color(0xFFECEEEF),
    surfaceVariant = Color(0xFF202428),
    onSurfaceVariant = Color(0xFF9BA3AA),
    outline = Color(0xFF30363C),
    outlineVariant = Color(0xFF24292E),
    error = Color(0xFFF97066),
    onError = Color(0xFF2B0A07)
)

private val LightStatus = StatusColors(
    success = Color(0xFF15803D),
    warning = Color(0xFFB45309),
    subtle = Color(0xFFEDEDE8)
)

private val DarkStatus = StatusColors(
    success = Color(0xFF4ADE80),
    warning = Color(0xFFFBBF24),
    subtle = Color(0xFF202428)
)

private const val TNUM = "tnum"

private val AppTypography = Typography(
    displayLarge = TextStyle(
        fontSize = 112.sp, lineHeight = 116.sp, fontWeight = FontWeight.Light,
        letterSpacing = (-2).sp, fontFeatureSettings = TNUM
    ),
    displayMedium = TextStyle(
        fontSize = 44.sp, lineHeight = 52.sp, fontWeight = FontWeight.Normal,
        fontFeatureSettings = TNUM
    ),
    headlineMedium = TextStyle(fontSize = 30.sp, lineHeight = 38.sp, fontWeight = FontWeight.SemiBold),
    headlineSmall = TextStyle(fontSize = 24.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 28.sp, fontWeight = FontWeight.Medium),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 26.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
)

private val AppShapes = Shapes(
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp)
)

@Composable
fun PontoTheme(mode: String, content: @Composable () -> Unit) {
    val dark = when (mode) {
        "LIGHT" -> false
        "DARK" -> true
        else -> isSystemInDarkTheme()
    }
    CompositionLocalProvider(LocalStatusColors provides if (dark) DarkStatus else LightStatus) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            typography = AppTypography,
            shapes = AppShapes,
            content = content
        )
    }
}
