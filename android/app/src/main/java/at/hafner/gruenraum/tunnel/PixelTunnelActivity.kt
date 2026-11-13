package at.hafner.gruenraum.tunnel

import android.Manifest
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Native Zugangsdaten-Einrichtung (FLAG_SECURE) für den direkten OpenAI-Pixel-Tunnel in Infinity.
 * Der Runtime-Schlüssel verbleibt ausschließlich im nativen Android Keystore und gelangt
 * niemals in den WebView-Kontext oder in Sicherungsdateien.
 */
class PixelTunnelActivity : AppCompatActivity() {

    private lateinit var config: PixelTunnelConfig

    private lateinit var statusBadgeText: TextView
    private lateinit var diagnosisText: TextView
    private lateinit var lastResponseValue: TextView
    private lateinit var lastContactValue: TextView
    private lateinit var accessValue: TextView
    private lateinit var revisionValue: TextView
    private lateinit var batteryText: TextView

    private lateinit var enabledSwitch: SwitchCompat
    private lateinit var writeSwitch: SwitchCompat
    private lateinit var toggleAdvancedButton: Button
    private lateinit var advancedContainer: LinearLayout

    private lateinit var tunnelIdInput: EditText
    private lateinit var organizationInput: EditText
    private lateinit var runtimeKeyInput: EditText
    private lateinit var saveAndStartButton: Button
    private lateinit var stopTunnelButton: Button
    private lateinit var bottomSecondaryButton: Button

    private var suppressSwitchCallback = false
    private var advancedExpanded = false
    private var requestedWrite: Boolean? = null

    private val statusListener: (JSONObject) -> Unit = { info ->
        runOnUiThread { applyStatusToViews(info) }
    }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val permitted = requestedWrite ?: return@registerForActivityResult
            requestedWrite = null
            if (!granted) {
                toast("Bitte Benachrichtigungen freigeben, damit du die laufende Verbindung sehen und beenden kannst.")
                refreshStatus()
                return@registerForActivityResult
            }
            launchConnection(permitted)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.WHITE
        window.navigationBarColor = Color.WHITE
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }

        config = PixelTunnelConfig(this)
        buildNativeLayout()

        tunnelIdInput.setText(config.id())
        organizationInput.setText(config.organization())
        if (!config.configured()) {
            advancedExpanded = true
            updateAdvancedVisibility()
        }

        PixelTunnelService.registerStatusListener(statusListener)
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onDestroy() {
        PixelTunnelService.unregisterStatusListener(statusListener)
        super.onDestroy()
    }

    private fun buildNativeLayout() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#F8F9FA"))
        }

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, windowInsets ->
            val bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        val scrollView = ScrollView(this).apply {
            isFillViewport = true
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        val headerTitle = TextView(this).apply {
            text = "Infinity · ChatGPT-Verbindung"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        val headerSub = TextView(this).apply {
            text = "Direkter privater OpenAI-Pixel-Tunnel (Google Pixel 10 Pro)"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, dp(2), 0, dp(12))
        }
        content.addView(headerTitle)
        content.addView(headerSub)

        // Status Card
        val statusCard = createCardLayout()
        statusBadgeText = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        diagnosisText = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(8), 0, dp(8))
        }
        statusCard.addView(statusBadgeText)
        statusCard.addView(diagnosisText)

        lastResponseValue = addInfoRow(statusCard, "Letzte beantwortete Anfrage")
        lastContactValue = addInfoRow(statusCard, "Letzter Tunnelkontakt")
        revisionValue = addInfoRow(statusCard, "Lokaler Infinity-Datenstand")
        accessValue = addInfoRow(statusCard, "Zugriff & Schreibfreigabe")
        content.addView(statusCard, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })

        // Switches Card
        val switchCard = createCardLayout()
        val enabledRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(4), 0, dp(8))
        }
        val enabledLabel = TextView(this).apply {
            text = "Pixel-Verbindung eingeschaltet"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        enabledSwitch = SwitchCompat(this).apply {
            setOnCheckedChangeListener { _, isChecked ->
                if (suppressSwitchCallback) return@setOnCheckedChangeListener
                if (isChecked) {
                    if (!config.configured()) {
                        suppressSwitchCallback = true
                        this.isChecked = false
                        suppressSwitchCallback = false
                        advancedExpanded = true
                        updateAdvancedVisibility()
                        toast("Bitte die Verbindung einmalig einrichten.")
                    } else {
                        requestConnection(config.writeEnabled())
                    }
                } else {
                    stopConnection()
                }
            }
        }
        enabledRow.addView(enabledLabel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        enabledRow.addView(enabledSwitch)
        switchCard.addView(enabledRow)

        val writeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, dp(4))
        }
        val writeLabel = TextView(this).apply {
            text = "ChatGPT darf Daten ändern"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
        }
        writeSwitch = SwitchCompat(this).apply {
            setOnCheckedChangeListener { _, isChecked ->
                if (suppressSwitchCallback) return@setOnCheckedChangeListener
                changeWrite(isChecked)
            }
        }
        writeRow.addView(writeLabel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        writeRow.addView(writeSwitch)
        switchCard.addView(writeRow)

        content.addView(switchCard, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })

        toggleAdvancedButton = Button(this).apply {
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor("#3138A0"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener {
                advancedExpanded = !advancedExpanded
                updateAdvancedVisibility()
            }
        }
        content.addView(toggleAdvancedButton)

        // Advanced Setup & Diagnostics Container
        advancedContainer = createCardLayout().apply {
            visibility = View.GONE
        }

        batteryText = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#475569"))
            setPadding(0, 0, 0, dp(10))
        }
        advancedContainer.addView(batteryText)

        val setupHeader = TextView(this).apply {
            text = "Einmalig einrichten (Nativer Android Keystore)"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(0, dp(4), 0, dp(8))
        }
        advancedContainer.addView(setupHeader)

        tunnelIdInput = createLabeledInput(
            advancedContainer,
            "Pixel-Tunnel-ID",
            "tunnel_…",
            isPassword = false
        )
        organizationInput = createLabeledInput(
            advancedContainer,
            "OpenAI-Organisation des Tunnels (optional)",
            "org-…",
            isPassword = false
        )
        runtimeKeyInput = createLabeledInput(
            advancedContainer,
            "Runtime-Schlüssel",
            if (config.configured()) "Bereits gespeichert · leer lassen" else "Schlüssel hier einfügen",
            isPassword = true
        )

        saveAndStartButton = Button(this).apply {
            text = "Einrichtung und Freigabe übernehmen"
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = roundedBg("#3138A0", dp(10))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setOnClickListener { startConnection() }
        }
        advancedContainer.addView(saveAndStartButton, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(8); bottomMargin = dp(8) })

        stopTunnelButton = Button(this).apply {
            text = "Verbindung beenden"
            isAllCaps = false
            setTextColor(Color.parseColor("#B42318"))
            background = roundedOutlineBg("#FECACA", "#FEF2F2", dp(10))
            setPadding(dp(12), dp(10), dp(12), dp(10))
            setOnClickListener { stopConnection() }
        }
        advancedContainer.addView(stopTunnelButton, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })

        val bgHeader = TextView(this).apply {
            text = "Hintergrundbetrieb & System-Einstellungen"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#0F172A"))
            setPadding(0, dp(4), 0, dp(6))
        }
        advancedContainer.addView(bgHeader)

        addLinkButton(advancedContainer, "Akku-Einstellungen öffnen") {
            openExternalSetting(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS, null)
        }
        addLinkButton(advancedContainer, "App- und Hintergrunddaten-Einstellungen") {
            openExternalSetting(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName")
            )
        }
        addLinkButton(advancedContainer, "OpenAI-Tunnel verwalten") {
            openExternalSetting(
                Intent.ACTION_VIEW,
                Uri.parse("https://platform.openai.com/settings/organization/tunnels")
            )
        }

        content.addView(advancedContainer, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(4); bottomMargin = dp(16) })

        scrollView.addView(content)
        root.addView(scrollView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))

        // Bottom Bar
        val bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(16), dp(10), dp(16), dp(10))
        }
        val refreshButton = Button(this).apply {
            text = "Status erneut prüfen"
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = roundedBg("#3138A0", dp(10))
            setOnClickListener { refreshStatus() }
        }
        bottomSecondaryButton = Button(this).apply {
            text = "Zurück"
            isAllCaps = false
            setTextColor(Color.parseColor("#1E293B"))
            background = roundedOutlineBg("#CBD5E1", "#F8FAFC", dp(10))
            setOnClickListener {
                if (config.enabled()) {
                    stopConnection()
                } else {
                    finish()
                }
            }
        }
        bottomBar.addView(refreshButton, LinearLayout.LayoutParams(0, dp(44), 1f).apply {
            rightMargin = dp(8)
        })
        bottomBar.addView(bottomSecondaryButton, LinearLayout.LayoutParams(0, dp(44), 1f))
        root.addView(bottomBar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        setContentView(root)
        updateAdvancedVisibility()
    }

    private fun updateAdvancedVisibility() {
        toggleAdvancedButton.text = if (advancedExpanded) {
            "Einrichtung und Diagnose schließen"
        } else {
            "Einrichtung und Diagnose öffnen"
        }
        advancedContainer.visibility = if (advancedExpanded) View.VISIBLE else View.GONE
    }

    private fun startConnection() {
        val enteredKey = runtimeKeyInput.text?.toString()?.trim().orEmpty()
        val enteredTunnel = tunnelIdInput.text?.toString()?.trim().orEmpty()
        val enteredOrg = organizationInput.text?.toString()?.trim().orEmpty()

        try {
            PixelTunnelConfig.validateId(enteredTunnel)
            PixelTunnelConfig.validateOrganization(enteredOrg)
            if (enteredKey.isNotEmpty()) {
                stopService(Intent(this, PixelTunnelService::class.java))
                config.save(enteredTunnel, enteredOrg, enteredKey)
            } else if (!config.configured() || config.id() != enteredTunnel) {
                throw IllegalArgumentException(
                    "Bitte für den neuen Tunnel den Runtime-Schlüssel eingeben."
                )
            } else if (config.organization() != enteredOrg) {
                stopService(Intent(this, PixelTunnelService::class.java))
                config.organization(enteredOrg)
            }
            if (enteredKey.isNotEmpty()) {
                runtimeKeyInput.setText("")
            }
            runtimeKeyInput.hint = "Bereits gespeichert · leer lassen"
            requestConnection(writeSwitch.isChecked)
        } catch (error: Exception) {
            AlertDialog.Builder(this)
                .setTitle("Verbindung noch nicht eingerichtet")
                .setMessage(
                    if (error is IllegalArgumentException) error.message
                    else "Einstellungen konnten nicht sicher gespeichert werden. Bitte erneut versuchen."
                )
                .setPositiveButton("OK", null)
                .show()
        }
    }

    private fun changeWrite(permitted: Boolean) {
        try {
            if (config.enabled() && config.configured()) {
                requestConnection(permitted)
            } else {
                config.writeEnabled(permitted)
                refreshStatus()
            }
        } catch (_: Exception) {
            refreshStatus()
        }
    }

    private fun requestConnection(permitted: Boolean) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            requestedWrite = permitted
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            requestedWrite = null
            launchConnection(permitted)
        }
    }

    private fun launchConnection(permitted: Boolean) {
        try {
            if (config.writeEnabled() != permitted) {
                stopService(Intent(this, PixelTunnelService::class.java))
            }
            config.writeEnabled(permitted)
            config.enabled(true)
            startForegroundService(Intent(this, PixelTunnelService::class.java))
            PixelTunnelService.notifyStatusListeners(this)
            refreshStatus()
        } catch (_: RuntimeException) {
            config.enabled(false)
            toast("Android hat den Dienststart eingeschränkt. Bitte die Akku-Einstellungen prüfen.")
            refreshStatus()
        }
    }

    private fun stopConnection() {
        requestedWrite = null
        try {
            config.enabled(false)
            stopService(Intent(this, PixelTunnelService::class.java))
        } catch (_: Exception) {
        }
        PixelTunnelService.notifyStatusListeners(this)
        refreshStatus()
    }

    private fun refreshStatus() {
        val info = PixelTunnelService.status(this)
        applyStatusToViews(info)
    }

    private fun applyStatusToViews(info: JSONObject) {
        val label = pixelConnectionLabel(info)
        val state = info.optString("state", "stopped")
        val confirmed = info.optBoolean("transport_confirmed", false)
        val isEnabled = info.optBoolean("enabled", false)
        val isWriteEnabled = info.optBoolean("write_enabled", false)
        val isConfigured = info.optBoolean("configured", false)

        statusBadgeText.text = label
        when {
            state in listOf("auth_error", "local_review_required", "start_blocked", "status_unavailable") -> {
                statusBadgeText.setTextColor(Color.parseColor("#B42318"))
                statusBadgeText.background = roundedOutlineBg("#FECACA", "#FEF2F2", dp(8))
            }
            !isEnabled -> {
                statusBadgeText.setTextColor(Color.parseColor("#334155"))
                statusBadgeText.background = roundedOutlineBg("#CBD5E1", "#F1F5F9", dp(8))
            }
            confirmed -> {
                statusBadgeText.setTextColor(Color.parseColor("#166534"))
                statusBadgeText.background = roundedOutlineBg("#BBF7D0", "#F0FDF4", dp(8))
            }
            else -> {
                statusBadgeText.setTextColor(Color.parseColor("#9A3412"))
                statusBadgeText.background = roundedOutlineBg("#FED7AA", "#FFF7ED", dp(8))
            }
        }

        diagnosisText.text = info.optString("detail", "")
        lastContactValue.text = pixelConnectionTime(
            info.optLong("last_contact_at", 0L),
            "Noch kein bestätigter Tunnelkontakt."
        )
        lastResponseValue.text = pixelConnectionTime(
            info.optLong("last_response_at", 0L),
            "Noch keine beantwortete Anfrage bestätigt."
        )
        revisionValue.text =
            "Revision #${info.optInt("local_revision", 0)} · Bestand: ${info.optString("dataset_id", "-")}"
        accessValue.text =
            (if (isEnabled) "Lesen lokal eingeschaltet." else "Verbindung und Zugriff ausgeschaltet.") +
                "\nGespeicherte Schreibfreigabe: " +
                (if (isWriteEnabled) "EIN." else "AUS.")

        batteryText.text = if (info.optBoolean("battery_exempt", false)) {
            "Akku-Ausnahme ist aktiv."
        } else {
            "Akku-Ausnahme noch nicht aktiv. Bei Energiesparen kann die Verbindung unterbrochen werden."
        }

        suppressSwitchCallback = true
        enabledSwitch.isChecked = isEnabled
        writeSwitch.isChecked = isWriteEnabled
        suppressSwitchCallback = false

        runtimeKeyInput.hint =
            if (isConfigured) "Bereits gespeichert · leer lassen" else "Schlüssel hier einfügen"
        bottomSecondaryButton.text = if (isEnabled) "Verbindung beenden" else "Zurück"
    }

    private fun createCardLayout(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedOutlineBg("#E2E8F0", "#FFFFFF", dp(14))
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }
    }

    private fun addInfoRow(parent: LinearLayout, title: String): TextView {
        val labelView = TextView(this).apply {
            text = title
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(6), 0, dp(1))
        }
        val valueView = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#0F172A"))
        }
        parent.addView(labelView)
        parent.addView(valueView)
        return valueView
    }

    private fun createLabeledInput(
        parent: LinearLayout,
        label: String,
        hintText: String,
        isPassword: Boolean
    ): EditText {
        val lbl = TextView(this).apply {
            text = label
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#334155"))
            setPadding(0, dp(6), 0, dp(4))
        }
        val input = EditText(this).apply {
            hint = hintText
            setSingleLine(true)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor("#0F172A"))
            setHintTextColor(Color.parseColor("#94A3B8"))
            background = roundedOutlineBg("#CBD5E1", "#F8FAFC", dp(8))
            setPadding(dp(12), dp(10), dp(12), dp(10))
            inputType = if (isPassword) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            }
        }
        parent.addView(lbl)
        parent.addView(input, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        return input
    }

    private fun addLinkButton(parent: LinearLayout, text: String, onClick: () -> Unit) {
        val btn = Button(this).apply {
            this.text = text
            isAllCaps = false
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(Color.parseColor("#3138A0"))
            background = roundedOutlineBg("#E0E7FF", "#EEF2FF", dp(8))
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setOnClickListener { onClick() }
        }
        parent.addView(btn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(6) })
    }

    private fun openExternalSetting(action: String, uri: Uri?) {
        try {
            startActivity(Intent(action).apply { if (uri != null) data = uri })
        } catch (_: ActivityNotFoundException) {
            toast("Diese Einstellung ist auf dem Gerät nicht verfügbar.")
        }
    }

    private fun roundedBg(fillHex: String, radiusPx: Int): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(fillHex))
            cornerRadius = radiusPx.toFloat()
        }
    }

    private fun roundedOutlineBg(strokeHex: String, fillHex: String, radiusPx: Int): GradientDrawable {
        return GradientDrawable().apply {
            setColor(Color.parseColor(fillHex))
            setStroke(dp(1), Color.parseColor(strokeHex))
            cornerRadius = radiusPx.toFloat()
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun toast(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show()
    }
}

internal fun pixelConnectionLabel(info: JSONObject): String =
    when {
        info.optString("state") == "status_unavailable" -> "Lokaler Status nicht lesbar"
        info.optString("state") == "auth_error" -> "Verbindungsfreigabe prüfen"
        !info.optBoolean("configured") -> "Noch nicht eingerichtet"
        !info.optBoolean("enabled") -> "Pixel-Verbindung ausgeschaltet"
        !info.optBoolean("running") -> "Tunnel eingeschaltet · Pixel-Dienst läuft nicht"
        info.optBoolean("transport_confirmed") -> "Tunnel eingeschaltet · letzter Kontakt bestätigt"
        info.optString("state") in
            listOf(
                "offline",
                "reconnecting",
                "rate_limited",
                "local_review_required",
                "start_blocked",
            ) -> "Tunnel eingeschaltet · derzeit nicht bestätigt"
        else -> "Tunnel eingeschaltet · Verbindung ausstehend"
    }

internal fun pixelConnectionTime(value: Long, empty: String): String =
    if (value <= 0L) empty
    else
        DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm:ss", Locale.GERMAN)
            .withZone(ZoneId.of("Europe/Vienna"))
            .format(Instant.ofEpochMilli(value))
