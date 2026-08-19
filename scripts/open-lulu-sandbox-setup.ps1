param(
    [switch]$SelfTest
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$projectRoot = if ($SelfTest) {
    Join-Path ([System.IO.Path]::GetTempPath()) ("jju-lulu-setup-selftest-" + [guid]::NewGuid().ToString("N"))
} else {
    Split-Path -Parent $PSScriptRoot
}
$envPath = Join-Path $projectRoot ".env.local"
$sandboxUrl = "https://developers.sandbox.lulu.com/"

function Format-EnvValue {
    param([string]$Value)

    $escaped = $Value.Replace("\", "\\").Replace('"', '\"').Replace("`r", "").Replace("`n", "\n")
    return '"' + $escaped + '"'
}

function Save-LuluEnvironment {
    param(
        [string]$ClientKey,
        [string]$ClientSecret,
        [string]$ContactEmail
    )

    $values = [ordered]@{
        LULU_CLIENT_KEY = $ClientKey.Trim()
        LULU_CLIENT_SECRET = $ClientSecret
        LULU_CONTACT_EMAIL = $ContactEmail.Trim()
    }

    $lines = [System.Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $envPath) {
        foreach ($existingLine in [System.IO.File]::ReadAllLines($envPath)) {
            $lines.Add($existingLine)
        }
    }

    foreach ($name in $values.Keys) {
        $replacement = $name + "=" + (Format-EnvValue -Value $values[$name])
        $matchIndex = -1
        for ($index = 0; $index -lt $lines.Count; $index++) {
            if ($lines[$index] -match ('^\s*' + [regex]::Escape($name) + '\s*=')) {
                $matchIndex = $index
                break
            }
        }

        if ($matchIndex -ge 0) {
            $lines[$matchIndex] = $replacement
        } else {
            if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne "") {
                $lines.Add("")
            }
            $lines.Add($replacement)
        }
    }

    $tempPath = $envPath + ".lulu-setup.tmp"
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllLines($tempPath, [string[]]$lines.ToArray(), $utf8NoBom)
    Move-Item -LiteralPath $tempPath -Destination $envPath -Force
}

if ($SelfTest) {
    try {
        [System.IO.Directory]::CreateDirectory($projectRoot) | Out-Null
        [System.IO.File]::WriteAllLines($envPath, [string[]]@("EXISTING_SETTING=kept"), [System.Text.UTF8Encoding]::new($false))
        Save-LuluEnvironment -ClientKey "sandbox-key" -ClientSecret "sandbox-secret" -ContactEmail "sandbox@example.com"
        $savedLines = [System.IO.File]::ReadAllLines($envPath)
        $requiredNames = @("EXISTING_SETTING", "LULU_CLIENT_KEY", "LULU_CLIENT_SECRET", "LULU_CONTACT_EMAIL")
        foreach ($requiredName in $requiredNames) {
            if (-not ($savedLines | Where-Object { $_ -match ('^' + [regex]::Escape($requiredName) + '=') })) {
                throw "Self-test failed to retain $requiredName"
            }
        }
        Write-Output "self-test-ok"
    } finally {
        if (Test-Path -LiteralPath $projectRoot) {
            Remove-Item -LiteralPath $projectRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    exit
}

$form = [System.Windows.Forms.Form]::new()
$form.Text = "JJ University - Lulu Sandbox Setup (fixed)"
$form.StartPosition = "CenterScreen"
$form.Size = [System.Drawing.Size]::new(610, 520)
$form.MinimumSize = [System.Drawing.Size]::new(610, 520)
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(22, 24, 28)
$form.ForeColor = [System.Drawing.Color]::FromArgb(244, 238, 225)
$form.Font = [System.Drawing.Font]::new("Segoe UI", 10)
$form.TopMost = $false

$title = [System.Windows.Forms.Label]::new()
$title.Text = "Connect the Lulu sandbox"
$title.Font = [System.Drawing.Font]::new("Segoe UI Semibold", 18)
$title.AutoSize = $true
$title.Location = [System.Drawing.Point]::new(26, 22)
$form.Controls.Add($title)

$instructions = [System.Windows.Forms.Label]::new()
$instructions.Text = "1. Create or sign in to the separate Lulu sandbox account.`r`n2. In the sandbox portal, open your profile and choose Client Keys & Secret.`r`n3. Paste the sandbox values below. They stay only in this project's ignored .env.local file."
$instructions.AutoSize = $false
$instructions.Size = [System.Drawing.Size]::new(548, 78)
$instructions.Location = [System.Drawing.Point]::new(29, 63)
$instructions.ForeColor = [System.Drawing.Color]::FromArgb(196, 190, 178)
$form.Controls.Add($instructions)

$openPortal = [System.Windows.Forms.Button]::new()
$openPortal.Text = "Open Lulu sandbox portal"
$openPortal.Size = [System.Drawing.Size]::new(210, 38)
$openPortal.Location = [System.Drawing.Point]::new(30, 137)
$openPortal.FlatStyle = "Flat"
$openPortal.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(212, 162, 76)
$openPortal.ForeColor = [System.Drawing.Color]::FromArgb(236, 190, 104)
$openPortal.Add_Click({
    [System.Diagnostics.Process]::Start([System.Diagnostics.ProcessStartInfo]@{
        FileName = $sandboxUrl
        UseShellExecute = $true
    }) | Out-Null
})
$form.Controls.Add($openPortal)

function Add-Field {
    param(
        [string]$LabelText,
        [int]$Top,
        [bool]$Masked = $false
    )

    $label = [System.Windows.Forms.Label]::new()
    $label.Text = $LabelText
    $label.AutoSize = $true
    $label.Location = [System.Drawing.Point]::new(30, $Top)
    $form.Controls.Add($label)

    $box = [System.Windows.Forms.TextBox]::new()
    $box.Size = [System.Drawing.Size]::new(545, 30)
    $box.Location = [System.Drawing.Point]::new(30, ($Top + 24))
    $box.UseSystemPasswordChar = $Masked
    $box.BackColor = [System.Drawing.Color]::FromArgb(40, 43, 49)
    $box.ForeColor = [System.Drawing.Color]::FromArgb(248, 243, 233)
    $box.BorderStyle = "FixedSingle"
    $form.Controls.Add($box)
    return $box
}

$keyBox = Add-Field -LabelText "Sandbox client key" -Top 194
$secretBox = Add-Field -LabelText "Sandbox client secret" -Top 264 -Masked $true
$emailBox = Add-Field -LabelText "Contact email for print-job notices" -Top 334

$showSecret = [System.Windows.Forms.CheckBox]::new()
$showSecret.Text = "Show secret"
$showSecret.AutoSize = $true
$showSecret.Location = [System.Drawing.Point]::new(463, 309)
$showSecret.Add_CheckedChanged({
    $secretBox.UseSystemPasswordChar = -not $showSecret.Checked
})
$form.Controls.Add($showSecret)

$saveButton = [System.Windows.Forms.Button]::new()
$saveButton.Text = "Save sandbox credentials"
$saveButton.Size = [System.Drawing.Size]::new(230, 42)
$saveButton.Location = [System.Drawing.Point]::new(30, 414)
$saveButton.FlatStyle = "Flat"
$saveButton.BackColor = [System.Drawing.Color]::FromArgb(190, 143, 68)
$saveButton.ForeColor = [System.Drawing.Color]::FromArgb(18, 18, 16)
$saveButton.FlatAppearance.BorderSize = 0
$form.Controls.Add($saveButton)

$status = [System.Windows.Forms.Label]::new()
$status.Text = "Nothing is sent until you choose Save. The preview must be restarted afterward."
$status.AutoSize = $false
$status.Size = [System.Drawing.Size]::new(300, 48)
$status.Location = [System.Drawing.Point]::new(277, 410)
$status.ForeColor = [System.Drawing.Color]::FromArgb(180, 176, 166)
$form.Controls.Add($status)

$saveButton.Add_Click({
    if ([string]::IsNullOrWhiteSpace($keyBox.Text) -or [string]::IsNullOrWhiteSpace($secretBox.Text)) {
        [System.Windows.Forms.MessageBox]::Show(
            $form,
            "The sandbox client key and client secret are required.",
            "Missing Lulu credentials",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }

    if ([string]::IsNullOrWhiteSpace($emailBox.Text) -or $emailBox.Text -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
        [System.Windows.Forms.MessageBox]::Show(
            $form,
            "Enter the email address that should receive Lulu print-job notices.",
            "Contact email required",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }

    try {
        Save-LuluEnvironment -ClientKey $keyBox.Text -ClientSecret $secretBox.Text -ContactEmail $emailBox.Text
        $keyBox.Clear()
        $secretBox.Clear()
        $emailBox.Clear()
        $showSecret.Checked = $false
        $status.Text = "Saved locally. Tell Codex when you're done so the preview can be restarted and tested."
        $status.ForeColor = [System.Drawing.Color]::FromArgb(139, 204, 151)
        [System.Windows.Forms.MessageBox]::Show(
            $form,
            "The sandbox credentials were saved locally. This window will stay open. Tell Codex when you are ready for the sandbox connection test.",
            "Lulu sandbox saved",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    } catch {
        $failureMessage = $_.Exception.Message
        $leftoverPath = $envPath + ".lulu-setup.tmp"
        if (Test-Path -LiteralPath $leftoverPath) {
            Remove-Item -LiteralPath $leftoverPath -Force -ErrorAction SilentlyContinue
        }
        $status.Text = "Could not save the local settings. No credentials were printed."
        $status.ForeColor = [System.Drawing.Color]::FromArgb(231, 126, 112)
        [System.Windows.Forms.MessageBox]::Show(
            $form,
            "The credentials could not be saved.`r`n`r`n$failureMessage`r`n`r`nNo credential value was printed or retained in a temporary file.",
            "Save failed",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
})

[void]$form.ShowDialog()
