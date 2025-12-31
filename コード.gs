function doPost(e) {
    try {
        var params = JSON.parse(e.postData.contents);
        var action = params.action || "export";
        
        // Retrieve API Key securely from Script Properties
        var geminiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

        // --- Action: List Models ---
        if (action === "listModels") {
            if (!geminiKey) {
                return ContentService.createTextOutput(JSON.stringify({
                    success: false,
                    error: "API Key not found in Script Properties."
                })).setMimeType(ContentService.MimeType.JSON);
            }
            
            var models = listGeminiModels(geminiKey);
            return ContentService.createTextOutput(JSON.stringify({
                success: true,
                models: models
            })).setMimeType(ContentService.MimeType.JSON);
        }

        // --- Action: Export (Default) ---
        var timestamp = new Date().toLocaleString();
        var title = "Gravity Slides Export - " + timestamp;
        var slidesData = params.slides || [];
        var useGemini = params.useGemini || false;
        var geminiModel = params.geminiModel || "gemini-1.5-flash-latest";
        var customPrompt = params.customPrompt || ""; // Get custom prompt

        var presentation = SlidesApp.create(title);
        var pUrl = presentation.getUrl();

        // Title Slide
        var slides = presentation.getSlides();
        var titleSlide = slides[0];
        if (titleSlide) {
            var shapes = titleSlide.getShapes();
            if (shapes.length > 0) shapes[0].getText().setText(title);
            if (shapes.length > 1) shapes[1].getText().setText("Created via Gravity Slides Extension");
        }

        for (var i = 0; i < slidesData.length; i++) {
            var item = slidesData[i];
            var slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
            
            // 1. Image Handling (Aspect Ratio Preserved)
            if (item.image) {
                var base64 = item.image.split(',')[1];
                var decoded = Utilities.base64Decode(base64);
                var blob = Utilities.newBlob(decoded, "image/png", "slide_image.png");
                
                var img = slide.insertImage(blob);
                
                var imgW = img.getWidth();
                var imgH = img.getHeight();
                var pageWidth = presentation.getPageWidth();
                var pageHeight = presentation.getPageHeight();
                
                var scale = Math.min(pageWidth / imgW, pageHeight / imgH);
                var newW = imgW * scale;
                var newH = imgH * scale;
                var left = (pageWidth - newW) / 2;
                var top = (pageHeight - newH) / 2;
                
                img.setWidth(newW);
                img.setHeight(newH);
                img.setLeft(left);
                img.setTop(top);
            }

            // 2. Note Handling
            let finalNote = item.note || "";

            // 3. Gemini Processing
            if (useGemini && finalNote) {
                if (!geminiKey) {
                    finalNote += "\n\n[System]: Gemini polishing skipped. 'GEMINI_API_KEY' not found in Script Properties.";
                } else {
                    try {
                        // Call Gemini with selected model and custom prompt
                        var result = callGemini(finalNote, geminiKey, geminiModel, customPrompt);
                        if (result.success) {
                            finalNote = result.text + "\n\n(✨ AI Polished via " + geminiModel + ")";
                        } else {
                            finalNote += "\n\n[Gemini Skipped]: " + result.reason;
                            // Debug disabled per user request
                            // if (result.debug) finalNote += "\n[Debug]: " + result.debug;
                        }
                    } catch (e) {
                        finalNote += "\n\n[Gemini Error]: " + e.toString();
                    }
                }
            }

            if (finalNote) {
                var notesPage = slide.getNotesPage();
                var speakerNotesShape = notesPage.getSpeakerNotesShape();
                speakerNotesShape.getText().setText(finalNote);
            }
        }

        presentation.saveAndClose();

        return ContentService.createTextOutput(JSON.stringify({
            success: true,
            url: pUrl
        })).setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({
            success: false,
            error: error.toString()
        })).setMimeType(ContentService.MimeType.JSON);
    }
}

/**
 * List available Gemini models
 */
function listGeminiModels(apiKey) {
    try {
        var url = "https://generativelanguage.googleapis.com/v1beta/models?key=" + apiKey;
        var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        var json = JSON.parse(response.getContentText());
        
        if (json.models) {
            // Filter only 'generateContent' supported models
            return json.models.filter(function(m) {
                return m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf("generateContent") > -1;
            }).map(function(m) {
                return { name: m.name }; // e.g. "models/gemini-1.5-flash"
            });
        }
        return [];
    } catch(e) {
        return [];
    }
}

/**
 * Call Google Gemini API
 */
function callGemini(text, apiKey, modelName, customPrompt) {
    if (!text) return { success: false, reason: "Empty text" };
    
    var model = modelName || "gemini-1.5-flash-latest";
    var modelId = model.replace(/^models\//, '');
    
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelId + ":generateContent?key=" + apiKey;
    
    // Use custom prompt if provided, otherwise default fallback (though client sends default)
    var promptCheck = customPrompt || "あなたはプロの編集者です。以下のテキストはスピーカーノートのメモです。これを「必ず」書き直してください。元の意味を維持しつつ、より説得力のある、自然な日本語の話し言葉（スピーチ原稿）に変換してください。短すぎる場合も、前後の文脈を想像して自然な文章に膨らませてください。";
    
    var content = promptCheck + "\n\n[元のテキスト]: " + text;
    
    var payload = {
        "contents": [{
            "parts": [{"text": content}]
        }],
        "generationConfig": {
            "temperature": 0.7
        }
    };
    
    var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
    };
    
    try {
        var response = UrlFetchApp.fetch(url, options);
        var responseCode = response.getResponseCode();
        var responseText = response.getContentText();
        var json = JSON.parse(responseText);
        
        if (responseCode !== 200) {
            return { 
                success: false, 
                reason: "API Error (" + responseCode + ")", 
                debug: json.error ? json.error.message : responseText 
            };
        }
        
        if (json.candidates && json.candidates.length > 0 && json.candidates[0].content) {
            return { 
                success: true, 
                text: json.candidates[0].content.parts[0].text 
            };
        } else {
             return { 
                success: false, 
                reason: "No candidates returned", 
                debug: JSON.stringify(json) 
            };
        }
    } catch (e) {
        return { success: false, reason: "Fetch Exception", debug: e.toString() };
    }
}

/**
 * 🛠️ Run this function ONCE in the editor to authorize the script.
 * 権限付与のために、この関数をエディタ上で一度「実行」してください。
 */
function authorizeScript() {
  console.log("Checking permissions...");
  // Just a dummy call to trigger scope request
  var response = UrlFetchApp.fetch("https://www.google.com");
  console.log("Authorization successful!");
}
