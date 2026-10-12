FINANCIAL VISUALIZATION TOOL - INSTALLATION
===========================================

Requirements: Windows 10 or 11 (64-bit). Nothing else is needed: Python and
Node.js are NOT required.


1. UNBLOCK THE ZIP (before extracting)
   Right-click the downloaded .zip > Properties > tick "Unblock" > OK.
   Then right-click > Extract All.

2. CHECK THE FILE IS GENUINE (optional but recommended)
   Open PowerShell in the extracted folder and run:
       Get-FileHash .\FinancialVisualizationTool-Setup-*.exe -Algorithm SHA256
   The value must match the one in SHA256SUMS.txt.

3. RUN THE INSTALLER
   Double-click FinancialVisualizationTool-Setup-<version>.exe.
   Windows may show "Windows protected your PC" because the installer is not
   code-signed. Click "More info", then "Run anyway".
   Follow the wizard: licence, install folder, shortcuts, install, finish.

4. FIRST SIGN-IN
   Username: admin@beko-technologies.com
   Password: the starting password provided to you separately.
   You must choose your own password straight away.

WHERE YOUR DATA IS KEPT
   %APPDATA%\FinancialVisualizationTool   (database, backups, uploads, logs)
   This folder is separate from the program, so updating or reinstalling keeps
   your data. Uninstalling also keeps it unless you choose to delete it and
   confirm twice.
