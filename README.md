# Pinfinity pro Android

Samostatná aplikace pro robota Joola Infinity. Nepotřebuje server, Docker, DNS ani certifikát. Tréninky ukládá v telefonu a s robotem komunikuje přímo přes Bluetooth.

Vychází z projektu [pinfinity](https://github.com/Wolle-Lukas/pinfinity) autora Wolle-Lukas. Ten projekt nemá licenci, proto tento repozitář drž soukromý a před zveřejněním se domluv s autorem.

## Sestavení APK přes GitHub
Repozitář musí být soukromý. Po nahrání na větev `main` proběhne workflow **Build APK**. Hotové APK stáhneš na GitHubu v **Actions → poslední běh → Artifacts → pinfinity-apk**.

## Sestavení na počítači
Potřebuješ Node.js 22, JDK 21 a Android Studio.

```bash
npm ci
npm test
npm run sync
cd android
./gradlew assembleDebug
```

APK vznikne v `android/app/build/outputs/apk/debug/app-debug.apk`.

## První zkouška s robotem
1. Odstup od robota a nastav míček s nízkou silou.
2. Připoj robota a použij tlačítko **Test**, které vystřelí jen jeden míček na bod.
3. Ověř, že tlačítko **Stop** zastaví běžící trénink.
4. Když něco nefunguje, pošli soubor z **Nastavení → Diagnostika → Sdílet log Bluetooth**.

## Kódování příkazů
Kódování základních, časovaných a pokročilých tréninků vychází z rozboru originální aplikace Joola Infinity 2.1.1, ne jen z webového klienta pinfinity. Oproti pinfinity se liší bajty 9 a 10 u některých bodů.

## Co zatím není
- Úpravy pokročilých tréninků: dají se spustit a označit jako oblíbené, ale ne měnit.
- Individuální kalibrace (`minorAdjustments`): originál si ji stahoval z cloudu.

## Podpis aplikace
`android/app/pinfinity-debug.keystore` je osobní podpisový klíč. Díky němu se nová verze nainstaluje přes starou a tréninky zůstanou zachované. Je určený jen pro osobní použití, ne pro Google Play.
