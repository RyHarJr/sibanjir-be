import { Router, Request, Response } from "express";

const router = Router();

// GET /weather?adm4=xxxx
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const originalAdm4 = (req.query.adm4 as string) || "16.71.01.1001";
    let adm4 = originalAdm4;

    let response = await fetch(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${adm4}`);
    
    // Fallback logic for unsupported villages inside the same district
    if (response.status === 404 && adm4.includes(".")) {
       const baseAdm3 = adm4.split(".").slice(0, 3).join(".");
       const fallbacks = ["1001", "1002", "2001", "2002"];
       
       for (const suffix of fallbacks) {
         const testAdm4 = `${baseAdm3}.${suffix}`;
         if (testAdm4 === originalAdm4) continue;
         
         const fbResponse = await fetch(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${testAdm4}`);
         if (fbResponse.ok) {
            response = fbResponse;
            break;
         }
       }
    }

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ success: false, message: "Region not found or unsupported by BMKG" });
        return;
      }
      throw new Error("Failed to fetch BMKG JSON data");
    }
    
    // Explicitly type to silence TS compiler
    const result = (await response.json()) as any;

    if (!result || !result.data || !result.data[0]) {
      res.status(404).json({ success: false, message: "Weather data not found in BMKG response" });
      return;
    }

    const cuacaData = result.data[0].cuaca;
    const flatCuaca = cuacaData.flat();

    const forecasts = flatCuaca.map((w: any) => {
      return {
        datetime: w.local_datetime,
        utc_datetime: w.utc_datetime,
        weatherCode: w.weather,
        weatherDesc: w.weather_desc,
        humidity: w.hu,
        temp: w.t,
        image: w.image,
      };
    });

    res.json({
      success: true,
      data: {
        city: result.lokasi.kotkab,
        domain: result.lokasi.provinsi,
        kecamatan: result.lokasi.kecamatan,
        forecasts,
      }
    });

  } catch (error) {
    console.error("Failed to fetch/parse weather data", error);
    res.status(500).json({ success: false, message: "Server error fetching weather" });
  }
});

export default router;
