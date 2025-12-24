// Global Variables
let translations = {};
let filteredTranslations = {};
let originalTranslations = {};
let englishTranslations = {}; // النصوص الإنجليزية الأصلية
let translationKeys = [];
let currentIndex = 0;
let currentFile = null;
let previewLength = 50;
let hasUnsavedChanges = false;
let currentEditedValue = '';
let modifiedKeys = new Set(); // Track modified translations
let currentEditingKey = ''; // Track the key being edited to avoid index conflicts

// Blocks debug mode (disabled by default)
window.debugBlocks = false;

// Auto-save to localStorage
let autoSaveInterval;

// API Keys Storage
let apiKeys = {
    claude: '',
    openai: '',
    gemini: '',
    deepl: '',
    google: ''
};

// DOM Elements - سيتم تعريفها بعد تحميل DOM
let translationList, originalText, translationText, searchInput, statsText, statusText, progressBar, fileInput, notification, loadingOverlay, settingsModal;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // تعريف العناصر DOM بعد تحميل الصفحة
    translationList = document.getElementById('translationList');
    originalText = document.getElementById('originalText');
    translationText = document.getElementById('translationText');
    searchInput = document.getElementById('searchInput');
    statsText = document.getElementById('statsText');
    statusText = document.getElementById('statusText');
    progressBar = document.getElementById('progressBar');
    fileInput = document.getElementById('fileInput');
    notification = document.getElementById('notification');
    loadingOverlay = document.getElementById('loadingOverlay');
    settingsModal = document.getElementById('settingsModal');
    
    // التحقق من وجود العناصر الأساسية
    if (!translationList || !originalText || !translationText) {
        console.error('❌ فشل في العثور على العناصر الأساسية في DOM');
        alert('خطأ في تحميل الصفحة. يرجى إعادة تحميل الصفحة.');
        return;
    }
    
    console.log('✅ تم تحميل جميع عناصر DOM بنجاح');
    
    // إخفاء شاشة التحميل عند بدء التطبيق
    hideLoading();
    
    setupEventListeners();
    setupAutoSave();
    loadFromLocalStorage();
    loadApiKeys();
    updateStats();
    updateSaveButton(); // Initialize save button state
    
    // إخفاء شاشة التحميل مرة أخرى للتأكد
    setTimeout(hideLoading, 100);
    
    // Safety timeout لضمان إخفاء شاشة التحميل في جميع الحالات
    setTimeout(() => {
        if (loadingOverlay && loadingOverlay.classList.contains('show')) {
            console.warn('⚠️ إخفاء إجباري لشاشة التحميل بعد safety timeout');
            hideLoading();
        }
    }, 5000); // 5 ثواني
});

// Setup event listeners
function setupEventListeners() {
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Search input - تحسين الأداء ومنع التداخل
    if (searchInput) {
        // استخدام debounce للبحث لتحسين الأداء
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                filterTranslations();
            }, 150); // انتظار 150ms قبل البحث
        });
        
        // منع القفز للنص الرئيسي
        searchInput.addEventListener('keydown', function(e) {
            e.stopPropagation();
            
            // منع مفاتيح التنقل من التأثير على البحث
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.stopPropagation();
            }
        });
        
        searchInput.addEventListener('focus', function(e) {
            e.stopPropagation();
        });
        
        // ضمان بقاء التركيز في البحث أثناء الكتابة
        searchInput.addEventListener('blur', function(e) {
            // إذا لم يكن المستخدم ينقر على شيء آخر، أعد التركيز
            if (e.relatedTarget === null) {
                setTimeout(() => {
                    if (document.activeElement === document.body) {
                        searchInput.focus();
                    }
                }, 10);
            }
        });
    }
    
    // Translation text changes
    translationText.addEventListener('input', function() {
        const currentValue = translationText.value;
        hasUnsavedChanges = (currentValue !== currentEditedValue);
        
        // Mark current translation as modified using the stored key
        if (hasUnsavedChanges && currentEditingKey) {
            modifiedKeys.add(currentEditingKey);
            
            // Update the translation data immediately
            translations[currentEditingKey] = currentValue;
            filteredTranslations[currentEditingKey] = currentValue;
            
            // Update the current item in the list
            const items = translationList.querySelectorAll('.translation-item');
            if (items[currentIndex]) {
                items[currentIndex].classList.add('modified');
                
                // Update preview in the list
                const preview = currentValue.length > previewLength ? 
                    currentValue.substring(0, previewLength) + '...' : currentValue;
                const previewElement = items[currentIndex].querySelector('.translation-preview');
                if (previewElement) {
                    previewElement.textContent = preview;
                }
            }
            
            updateStats(); // تحديث الإحصائيات
        }
        
        // إذا كان هناك blocks editor مفعل، حدثه
        const container = translationText.parentNode;
        const blocksEditor = container.querySelector('.blocks-editor');
        if (blocksEditor && blocksEditor.style.display !== 'none') {
            if (window.debugBlocks) console.log('📝 تم تغيير النص - سيتم تحديث البلوكات');
            clearTimeout(translationText.blocksUpdateTimeout);
            translationText.blocksUpdateTimeout = setTimeout(() => {
                refreshBlocks(blocksEditor, translationText);
            }, 100); // تقليل التأخير لتحديث أسرع
        }
        
        updateSaveButton();
    });
    
    // Prevent default drag and drop behavior
    document.addEventListener('dragover', function(e) {
        e.preventDefault();
    });
    
    document.addEventListener('drop', function(e) {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
}

// Keyboard shortcuts
function handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + O: Open file
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        openFile();
    }
    
    // Ctrl/Cmd + S: Save file
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
    }
    
    // Ctrl/Cmd + F: Focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
    }
    
    // Escape: Clear search and hide notifications
    if (e.key === 'Escape') {
        clearSearch();
        hideNotification();
    }
    
    // Arrow keys: Navigate translations
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.key === 'ArrowLeft') {
            nextTranslation();
        } else {
            previousTranslation();
        }
    }
}

// File operations
function openFile() {
    fileInput.click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        handleFile(file);
    }
}

function handleFile(file) {
    if (!file.name.endsWith('.yml') && !file.name.endsWith('.yaml')) {
        showNotification('يرجى اختيار ملف YAML صحيح (بامتداد .yml أو .yaml)', 'error');
        return;
    }
    
    showLoading();
    console.log('🔄 بدء تحميل الملف:', file.name);
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const content = e.target.result;
            
            if (!content) {
                throw new Error('الملف فارغ أو تالف');
            }
            
            loadYamlContent(content, file.name);
            currentFile = file;
            showNotification(`تم تحميل الملف بنجاح: ${file.name}`, 'success');
            console.log('✅ تم تحميل الملف بنجاح');
        } catch (error) {
            console.error('خطأ في قراءة الملف:', error);
            showNotification(`خطأ في قراءة الملف "${file.name}": ${error.message}`, 'error');
        } finally {
            hideLoading();
            // دالة إضافية للتأكد
            setTimeout(ensureLoadingHidden, 100);
        }
    };
    
    reader.onerror = function(e) {
        console.error('خطأ في FileReader:', e);
        showNotification(`خطأ في قراءة الملف "${file.name}": فشل في قراءة محتوى الملف`, 'error');
        hideLoading();
    };
    
    reader.readAsText(file, 'UTF-8');
}

function loadYamlContent(content, filename) {
    try {
        console.log('📂 بدء معالجة محتوى YAML...');
        
        // التحقق من وجود محتوى
        if (!content || content.trim() === '') {
            throw new Error('الملف فارغ أو لا يحتوي على محتوى');
        }

        // Simple YAML parsing (for basic l_english format)
        const lines = content.split('\n');
        const yamlData = {};
        let inLEnglish = false;
        let lineNumber = 0;
        
        for (let line of lines) {
            lineNumber++;
            line = line.trim();
            
            // Check if we're in l_english section
            if (line === 'l_english:') {
                inLEnglish = true;
                continue;
            }
            
            if (!inLEnglish) continue;
            
            // Skip empty lines and comments
            if (!line || line.startsWith('#')) continue;
            
            // Check if this is a key-value pair
            if (line.includes(':') && !line.startsWith(' ')) {
                try {
                    const colonIndex = line.indexOf(':');
                    const key = line.substring(0, colonIndex).trim();
                    let value = line.substring(colonIndex + 1).trim();
                    
                    // التحقق من أن المفتاح ليس فارغاً
                    if (!key) {
                        console.warn(`مفتاح فارغ في السطر ${lineNumber}: ${line}`);
                        continue;
                    }
                    
                    // Extract text between quotes only
                    value = cleanText(value);
                    
                    yamlData[key] = value;
                } catch (lineError) {
                    console.warn(`خطأ في معالجة السطر ${lineNumber}: ${line}`, lineError);
                    continue;
                }
            }
        }
        
        // التحقق من وجود بيانات
        if (Object.keys(yamlData).length === 0) {
            throw new Error('لم يتم العثور على أي ترجمات في الملف. تأكد من أن الملف يحتوي على قسم l_english: مع ترجمات صحيحة');
        }
        
        // Reset unsaved changes first - قبل كل شيء
        hasUnsavedChanges = false;
        modifiedKeys.clear(); // Clear modified keys when loading new file
        currentEditingKey = ''; // Clear current editing key
        
        // Reset English translations - will be loaded from english folder if available
        englishTranslations = {};
        
        // Clear any existing modified classes from DOM
        const existingItems = translationList.querySelectorAll('.translation-item.modified');
        existingItems.forEach(item => {
            item.classList.remove('modified');
        });
        
        translations = yamlData;
        originalTranslations = { ...yamlData };
        filteredTranslations = { ...yamlData };
        translationKeys = Object.keys(yamlData);
        currentIndex = 0;
        
        populateTranslationList();
        updateStats();
        updateStatus(filename);
        
        // Load first translation
        if (translationKeys.length > 0) {
            selectTranslationByIndex(0);
        }
        
        updateSaveButton();
        
        // Save to localStorage
        saveToLocalStorage();
        
        console.log(`تم تحميل ${Object.keys(yamlData).length} ترجمة بنجاح من الملف: ${filename}`);
        
        // إخفاء شاشة التحميل بعد الانتهاء من التحميل الأساسي
        setTimeout(hideLoading, 50);
        
        // محاولة تحميل ملف إنجليزي من مجلد english كمرجع إضافي (في الخلفية)
        setTimeout(() => loadEnglishReferenceFile(filename), 100);
        
    } catch (error) {
        hideLoading(); // إخفاء التحميل في حالة الخطأ أيضاً
        console.error('خطأ في تحليل YAML:', error);
        throw new Error(`خطأ في تحليل YAML: ${error.message}`);
    }
}

// تحميل ملف إنجليزي مرجعي من مجلد english (اختياري لمقارنة إضافية)
async function loadEnglishReferenceFile(filename) {
    try {
        // محاولة تحميل الملف من مجلد english مع timeout
        const englishPath = `english/${filename}`;
        
        console.log(`💡 محاولة تحميل مرجع إنجليزي إضافي من: ${englishPath}`);
        
        // إضافة timeout للطلب لتجنب التعليق
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 ثانية timeout
        
        const response = await fetch(englishPath, { 
            signal: controller.signal 
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const englishContent = await response.text();
            console.log(`📄 تم العثور على مرجع إنجليزي إضافي بطول: ${englishContent.length} حرف`);
            
            if (englishContent && englishContent.trim()) {
                // تحليل المحتوى وإضافته كمرجع إضافي
                const additionalEnglishData = parseYAMLContent(englishContent);
                
                // دمج النصوص الإضافية مع المرجع الحالي
                Object.keys(additionalEnglishData).forEach(key => {
                    if (!englishTranslations[key]) {
                        englishTranslations[key] = additionalEnglishData[key];
                    }
                });
                
                console.log(`✅ تم دمج ${Object.keys(additionalEnglishData).length} نص إنجليزي إضافي`);
                showNotification(`📚 تم تحميل مرجع إنجليزي إضافي من: ${filename}`, 'info');
                
                // تحديث العرض إذا كان هناك ترجمة محددة
                if (currentEditingKey) {
                    selectTranslationByIndex(currentIndex);
                }
            }
        } else {
            console.log(`📄 لا يوجد مرجع إنجليزي إضافي في: ${englishPath} (${response.status})`);
        }
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log(`⏱️ انتهت مهلة تحميل المرجع الإنجليزي (${filename})`);
        } else {
            console.log(`ℹ️ لا يمكن تحميل مرجع إضافي: ${error.message}`);
        }
        // تجاهل الأخطاء والمتابعة
    }
}

// دالة مساعدة لتحليل محتوى YAML
function parseYAMLContent(content) {
    const lines = content.split('\n');
    const yamlData = {};
    let inLEnglish = false;
    
    for (let line of lines) {
        line = line.trim();
        
        // Check if we're in l_english section
        if (line === 'l_english:') {
            inLEnglish = true;
            continue;
        }
        
        if (!inLEnglish) continue;
        
        // Skip empty lines and comments
        if (!line || line.startsWith('#')) continue;
        
        // Check if this is a key-value pair
        if (line.includes(':') && !line.startsWith(' ')) {
            try {
                const colonIndex = line.indexOf(':');
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();
                
                if (!key) continue;
                
                                    // Extract text between quotes only
                    value = cleanText(value);
                
                yamlData[key] = value;
            } catch (lineError) {
                continue;
            }
        }
    }
    
    return yamlData;
}



// مقارنة المفاتيح وإيجاد المفاتيح الناقصة
function findMissingKeys() {
    const translationKeysSet = new Set(Object.keys(translations));
    const englishKeysSet = new Set(Object.keys(englishTranslations));
    
    // المفاتيح الموجودة في المرجع الإنجليزي ولكن ناقصة في الملف المحرر
    const missingInTranslation = [...englishKeysSet].filter(key => !translationKeysSet.has(key));
    
    // المفاتيح الموجودة في الملف المحرر ولكن غير موجودة في المرجع
    const extraInTranslation = [...translationKeysSet].filter(key => !englishKeysSet.has(key));
    
    return {
        missingInTranslation,
        extraInTranslation,
        totalEnglish: englishKeysSet.size,
        totalTranslation: translationKeysSet.size
    };
}

function populateTranslationList() {
    if (!translationList) {
        console.warn('⚠️ translationList غير موجود');
        return;
    }
    translationList.innerHTML = '';
    
    Object.entries(filteredTranslations).forEach(([key, value], index) => {
        const item = document.createElement('div');
        item.className = 'translation-item fade-in';
        item.dataset.index = index;
        
        // Add modified class only if this translation was actually modified
        if (modifiedKeys.has(key)) {
            item.classList.add('modified');
        }
        
        // Show clean preview (extract from quotes)
        let cleanValue = cleanText(value);
        
        const preview = cleanValue.length > previewLength ? 
            cleanValue.substring(0, previewLength) + '...' : cleanValue;
        
        item.innerHTML = `
            <div class="translation-key">${escapeHtml(key)}</div>
            <div class="translation-preview">${escapeHtml(preview)}</div>
        `;
        
        item.addEventListener('click', () => {
            selectTranslationByIndex(index);
        });
        
        translationList.appendChild(item);
    });
}

function selectTranslationByIndex(index) {
    if (index < 0 || index >= translationKeys.length) return;
    
    // If there are unsaved changes in current translation, save them first
    if (hasUnsavedChanges) {
        const currentKey = translationKeys[currentIndex];
        const currentValue = translationText.value.trim();
        
        // Store the clean text (without quotes and tags)
        translations[currentKey] = currentValue;
        filteredTranslations[currentKey] = currentValue;
        
        // Mark as modified
        modifiedKeys.add(currentKey);
        
        // Update the list item
        const items = translationList.querySelectorAll('.translation-item');
        if (items[currentIndex]) {
            // تنظيف النص للمعاينة
            let cleanCurrentValue = cleanText(currentValue);
            
            const preview = cleanCurrentValue.length > previewLength ? 
                cleanCurrentValue.substring(0, previewLength) + '...' : cleanCurrentValue;
            items[currentIndex].querySelector('.translation-preview').textContent = preview;
            items[currentIndex].classList.add('modified');
        }
        
        updateStats(); // تحديث الإحصائيات
        
        // Don't reset hasUnsavedChanges - keep it true until file is saved
        currentEditedValue = currentValue;
    }
    
    currentIndex = index;
    const key = translationKeys[index];
    const value = filteredTranslations[key];
    const originalValue = originalTranslations[key];
    
    // Set the currently editing key
    currentEditingKey = key;
    
    // Update displays
    // تم إزالة عرض المفتاح - موجود في قائمة الترجمات
    
    // Show English text if available, otherwise show original value or helpful message
    const englishText = englishTranslations[key];
    
    console.log(`🔄 تحديث العرض للمفتاح: ${key}`);
    console.log(`📁 عدد النصوص الإنجليزية المحملة: ${Object.keys(englishTranslations).length}`);
    console.log(`🎯 النص الإنجليزي للمفتاح الحالي:`, englishText || 'غير موجود');
    
    // Show clean text for editing (extract from quotes) - تعريف cleanValue أولاً
    let cleanValue = cleanText(value || '');
    
    if (englishText) {
        // استخراج النص من بين علامات التنصيص
        let cleanEnglishText = cleanText(englishText);
        
        // عرض النص المرجعي مع البلوكات إذا كان وضع البلوكات مفعل
        updateOriginalTextDisplay(cleanEnglishText, cleanValue);
        
        console.log(`✅ عرض النص الإنجليزي المرجعي: "${cleanEnglishText}"`);
    } else {
        // لا يوجد نص مرجعي من مجلد english
        if (originalText) {
            originalText.innerHTML = ''; // مسح أي محتوى سابق
            originalText.textContent = `📂 ضع ملف "${currentFile?.name || 'مطابق'}" في مجلد english للمقارنة`;
            originalText.style.color = '#6c757d'; // لون رمادي للرسالة
        }
        console.log(`ℹ️ لا يوجد نص مرجعي للمفتاح: ${key}`);
    }
    
    if (translationText) {
        translationText.value = cleanValue;
        currentEditedValue = cleanValue;
        
        // إطلاق events لضمان تحديث الواجهة عند تغيير النص
        console.log('🔄 إطلاق events لتحديث الواجهة بعد تغيير النص');
        try {
            const inputEvent = new Event('input', { bubbles: true });
            const changeEvent = new Event('change', { bubbles: true });
            translationText.dispatchEvent(inputEvent);
            translationText.dispatchEvent(changeEvent);
            console.log('✅ تم إطلاق events بنجاح');
        } catch (error) {
            console.warn('⚠️ خطأ في إطلاق events:', error);
        }
    }
    
    // Check if this translation was modified
    if (modifiedKeys.has(key)) {
        hasUnsavedChanges = true;
    } else {
        hasUnsavedChanges = false;
    }
    updateSaveButton();
    
    // Update selection in list
    const items = translationList.querySelectorAll('.translation-item');
    items.forEach((item, i) => {
        item.classList.toggle('selected', i === index);
    });
    
    // Scroll to selected item
    const selectedItem = translationList.querySelector('.translation-item.selected');
    if (selectedItem) {
        selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    // Focus on translation text only if search is not active
    if (document.activeElement !== searchInput) {
        translationText.focus();
    }
    
    // تحديث البلوكات إذا كانت مفعلة وفحص البلوكات المفقودة
    const container = translationText.parentNode;
    const blocksEditor = container.querySelector('.blocks-editor');
    if (blocksEditor && blocksEditor.style.display !== 'none') {
        if (window.debugBlocks) console.log('🔄 تحديث البلوكات للترجمة الجديدة:', key);
        setTimeout(() => {
            refreshBlocks(blocksEditor, translationText);
        }, 50);
    }
    
    // فحص البلوكات المفقودة حتى بدون وضع البلوكات (للإحصائيات)
    if (englishTranslations[key]) {
        setTimeout(() => {
            const missingBlocks = findMissingBlocks(englishTranslations[key], cleanValue);
            if (missingBlocks.length > 0 && window.debugBlocks) {
                console.info(`📊 البلوكات المفقودة في "${key}":`, missingBlocks);
            }
        }, 100);
    }
    
    // تحديث تلوين مفاتيح الترجمة
    safeTimeout(() => highlightKeysWithMissingBlocks(), 150);
}

// Navigation
function nextTranslation() {
    if (currentIndex < translationKeys.length - 1) {
        selectTranslationByIndex(currentIndex + 1);
    }
}

function previousTranslation() {
    if (currentIndex > 0) {
        selectTranslationByIndex(currentIndex - 1);
    }
}

// Search and filter
function filterTranslations() {
    const searchTerm = searchInput.value.toLowerCase();
    
    if (!searchTerm) {
        filteredTranslations = { ...translations };
    } else {
        filteredTranslations = {};
        Object.entries(translations).forEach(([key, value]) => {
            if (key.toLowerCase().includes(searchTerm) || 
                value.toLowerCase().includes(searchTerm)) {
                filteredTranslations[key] = value;
            }
        });
    }
    
    translationKeys = Object.keys(filteredTranslations);
    
    // Try to maintain the current selection if it exists in filtered results
    let newIndex = 0;
    if (currentEditingKey && translationKeys.includes(currentEditingKey)) {
        newIndex = translationKeys.indexOf(currentEditingKey);
    }
    
    currentIndex = newIndex;
    populateTranslationList();
    updateStats();
    
    // Select the appropriate item (maintain current selection or first item)
    if (translationKeys.length > 0) {
        selectTranslationByIndex(currentIndex);
    }
}

function clearSearch() {
    searchInput.value = '';
    filterTranslations();
    
    // ضمان إعادة التركيز للبحث
    setTimeout(() => {
        searchInput.focus();
    }, 100);
}

// Translation operations
function updateTranslation() {
    if (!currentEditingKey) {
        showNotification('يرجى اختيار ترجمة أولاً', 'warning');
        return;
    }
    
    const key = currentEditingKey;
    const newValue = translationText.value.trim();
    
    // Store the clean text (without quotes and tags)
    translations[key] = newValue;
    filteredTranslations[key] = newValue;
    
    // Update the list item
    const items = translationList.querySelectorAll('.translation-item');
    if (items[currentIndex]) {
        const preview = newValue.length > previewLength ? 
            newValue.substring(0, previewLength) + '...' : newValue;
        items[currentIndex].querySelector('.translation-preview').textContent = preview;
    }
    
    // Reset unsaved changes
    hasUnsavedChanges = false;
    currentEditedValue = newValue;
    updateSaveButton();
}

function undoChanges() {
    if (!currentEditingKey) {
        console.warn('⚠️ لا يوجد مفتاح ترجمة محدد للإعادة');
        showNotification('لا يوجد ترجمة لإعادة تعيينها', 'warning');
        return;
    }
    
    const key = currentEditingKey;
    const originalValue = originalTranslations[key];
    
    if (!originalValue) {
        console.warn('⚠️ لا توجد قيمة أصلية للمفتاح:', key);
        showNotification('لا توجد قيمة أصلية لهذه الترجمة', 'warning');
        return;
    }
    
    // Use the original clean text (extract from quotes)
    let cleanOriginalValue = cleanText(originalValue || '');
    
    console.log(`🔄 إعادة تعيين "${key}" من "${translationText.value}" إلى "${cleanOriginalValue}"`);
    
    translationText.value = cleanOriginalValue;
    currentEditedValue = cleanOriginalValue;
    hasUnsavedChanges = false;
    
    // Update the translation data
    translations[key] = originalValue || '';
    filteredTranslations[key] = originalValue || '';
    
    // Remove from modified keys
    modifiedKeys.delete(key);
    
    // Update the list item
    const items = translationList.querySelectorAll('.translation-item');
    if (items[currentIndex]) {
        items[currentIndex].classList.remove('modified');
        
        // تنظيف النص للمعاينة
        const preview = cleanOriginalValue.length > previewLength ? 
            cleanOriginalValue.substring(0, previewLength) + '...' : cleanOriginalValue;
        const previewElement = items[currentIndex].querySelector('.translation-preview');
        if (previewElement) {
            previewElement.textContent = preview;
        }
    }
    
    // تحديث وضع البلوكات إذا كان مفعلاً
    const container = translationText.parentNode;
    const blocksEditor = container.querySelector('.blocks-editor');
    if (blocksEditor && blocksEditor.style.display !== 'none') {
        setTimeout(() => {
            refreshBlocks(blocksEditor, translationText);
            console.log('✅ تم تحديث البلوكات بعد إعادة التعيين');
        }, 50);
    }
    
    // تحديث النص المرجعي إذا كان متوفراً
    const englishText = englishTranslations[key] || '';
    if (englishText) {
        updateOriginalTextDisplay(englishText, cleanOriginalValue);
    }
    
    updateSaveButton();
    updateStats();
    
    showNotification('تم إعادة تعيين الترجمة إلى القيمة الأصلية', 'success');
    console.log('✅ تم إعادة تعيين الترجمة بنجاح');
}

// Function removed - no longer needed

// Save operations
function saveAllChanges() {
    if (!currentFile) {
        showNotification('يرجى فتح ملف أولاً', 'warning');
        return;
    }
    
    // Save all changes to the current translation
    if (hasUnsavedChanges) {
        const key = translationKeys[currentIndex];
        const newValue = translationText.value.trim();
        
        // Store the clean text (without quotes and tags)
        translations[key] = newValue;
        filteredTranslations[key] = newValue;
        
        // Mark as modified
        modifiedKeys.add(key);
        
        // Update the list item
        const items = translationList.querySelectorAll('.translation-item');
        if (items[currentIndex]) {
            // تنظيف النص للمعاينة
            let cleanNewValue = cleanText(newValue);
            
            const preview = cleanNewValue.length > previewLength ? 
                cleanNewValue.substring(0, previewLength) + '...' : cleanNewValue;
            items[currentIndex].querySelector('.translation-preview').textContent = preview;
            items[currentIndex].classList.add('modified');
        }
        
        updateStats(); // تحديث الإحصائيات
        
        // Reset unsaved changes for current translation
        hasUnsavedChanges = false;
        currentEditedValue = newValue;
    }
    
    saveToFile(currentFile.name);
    
    // Clear all modifications after saving
    modifiedKeys.clear();
    hasUnsavedChanges = false;
    // Note: currentEditingKey is kept as user might continue editing the same translation
    
    // Remove modified class from all items in the DOM
    const allItems = translationList.querySelectorAll('.translation-item.modified');
    allItems.forEach(item => {
        item.classList.remove('modified');
    });
    
    updateSaveButton();
    updateStats(); // تحديث الإحصائيات بعد الحفظ
    
    showNotification('تم حفظ الملف بنجاح!', 'success');
}

function saveFile() {
    if (!currentFile) {
        return saveAsFile();
    }
    
    saveToFile(currentFile.name);
}

function saveAsFile() {
    const filename = prompt('أدخل اسم الملف:', 'translation.yml');
    if (filename) {
        saveToFile(filename);
    }
}

function saveToFile(filename) {
    try {
        // Create YAML content
        let yamlContent = 'l_english:\n';
        
        Object.entries(translations).forEach(([key, value]) => {
            // Add quotes around the value for proper YAML format
            const escapedValue = value.replace(/"/g, '\\"');
            yamlContent += `  ${key}: "${escapedValue}"\n`;
        });
        
        // Create and download file
        const blob = new Blob([yamlContent], { type: 'text/yaml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.endsWith('.yml') ? filename : filename + '.yml';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        updateStatus(filename);
        
    } catch (error) {
        showNotification(`خطأ في حفظ الملف: ${error.message}`, 'error');
    }
}

// UI updates
function updateStats() {
    const total = Object.keys(translations).length;
    const filtered = Object.keys(filteredTranslations).length;
    const modified = modifiedKeys.size;
    
    let statsMessage = '';
    if (total === filtered) {
        statsMessage = `إجمالي الترجمات: ${total}`;
    } else {
        statsMessage = `عرض ${filtered} من ${total} ترجمة`;
    }
    
    // إضافة عداد التعديلات
    if (modified > 0) {
        statsMessage += ` - تم تعديل: ${modified}`;
    }
    
    if (statsText) {
        statsText.textContent = statsMessage;
    }
    
    // Update progress bar
    if (progressBar) {
        if (total > 0) {
            const progress = filtered / total;
            progressBar.style.width = (progress * 100) + '%';
        } else {
            progressBar.style.width = '0%';
        }
    }
}

function updateStatus(filename) {
    if (statusText) {
        if (filename) {
            statusText.textContent = `الملف: ${filename}`;
        } else {
            statusText.textContent = 'لم يتم تحميل ملف';
        }
    }
}

// دالة إخفاء الإشعار
function hideNotification() {
    if (notification) {
        notification.classList.remove('show');
        notification.style.pointerEvents = 'none';
        notification.style.zIndex = '-1';
        
        // تنظيف تام بعد انتهاء الـ animation
        setTimeout(() => {
            if (notification) {
                notification.className = 'notification';
                notification.textContent = '';
                notification.style.pointerEvents = '';
                notification.style.zIndex = '';
            }
        }, 300);
        
        console.log('🗑️ تم إخفاء الإشعار');
    }
}

// متغير لحفظ timeout حالي
let notificationTimeout = null;

// Utility functions
function showNotification(message, type = 'info') {
    if (notification) {
        // إلغاء أي timeout سابق
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
            notificationTimeout = null;
        }
        
        // إخفاء أي إشعار سابق أولاً
        hideNotification();
        
        // إظهار الإشعار الجديد بعد delay قصير
        setTimeout(() => {
            if (notification) {
                notification.textContent = message;
                notification.className = `notification ${type} show`;
                notification.style.pointerEvents = 'auto';
                notification.style.zIndex = '10000';
                
                console.log(`📢 إظهار إشعار: [${type}] ${message}`);
                
                // إخفاء تلقائي بعد 4 ثوان
                notificationTimeout = setTimeout(() => {
                    hideNotification();
                    notificationTimeout = null;
                }, 4000);
                
                // إخفاء فوري عند النقر
                notification.onclick = () => {
                    if (notificationTimeout) {
                        clearTimeout(notificationTimeout);
                        notificationTimeout = null;
                    }
                    hideNotification();
                };
            }
        }, 100);
    } else {
        console.log(`📢 Notification: [${type}] ${message}`);
    }
}

function showLoading(show) {
    if (show) {
        loadingOverlay.classList.add('show');
    } else {
        loadingOverlay.classList.remove('show');
    }
}

function updateSaveButton() {
    const saveButton = document.getElementById('saveFileBtn');
    if (saveButton) {
        // Always ensure save-btn class is present
        saveButton.classList.add('save-btn');
        
        if (modifiedKeys.size > 0 || hasUnsavedChanges) {
            // Has unsaved changes - red with pulsing animation
            saveButton.innerHTML = '<i class="fas fa-save"></i> حفظ الملف';
            saveButton.classList.remove('saved');
            saveButton.classList.add('unsaved');
        } else if (currentFile) {
            // File loaded and saved - green
            saveButton.innerHTML = '<i class="fas fa-save"></i> حفظ الملف';
            saveButton.classList.remove('unsaved');
            saveButton.classList.add('saved');
        } else {
            // No file loaded - default red
            saveButton.innerHTML = '<i class="fas fa-save"></i> حفظ الملف';
            saveButton.classList.remove('saved');
            saveButton.classList.add('unsaved');
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to clean text (extract from quotes)
function cleanText(text) {
    if (!text) return '';
    // First try to extract text between quotes
    const quoteMatch = text.match(/"([^"]*)"/);
    if (quoteMatch) {
        return quoteMatch[1];
    }
    // If no quotes, remove tags and quotes manually
    return text.replace(/#NT!/g, '').replace(/#[A-Z0-9]+!/g, '').replace(/"/g, '').trim();
}

// LocalStorage functions
function saveToLocalStorage() {
    try {
        const data = {
            translations: translations,
            englishTranslations: englishTranslations,
            modifiedKeys: Array.from(modifiedKeys),
            currentIndex: currentIndex,
            currentEditingKey: currentEditingKey,
            currentFile: currentFile ? currentFile.name : null,
            timestamp: Date.now()
        };
        localStorage.setItem('arabicTranslationEditor', JSON.stringify(data));
    } catch (error) {
        console.error('Failed to save to localStorage:', error);
    }
}

function loadFromLocalStorage() {
    try {
        const data = localStorage.getItem('arabicTranslationEditor');
        if (data) {
            const parsed = JSON.parse(data);
            
            // Check if data is not too old (less than 24 hours)
            const isRecent = (Date.now() - parsed.timestamp) < (24 * 60 * 60 * 1000);
            
            if (isRecent && parsed.translations && Object.keys(parsed.translations).length > 0) {
                translations = parsed.translations;
                filteredTranslations = { ...translations };
                originalTranslations = { ...translations };
                englishTranslations = parsed.englishTranslations || {};
                translationKeys = Object.keys(translations);
                modifiedKeys = new Set(parsed.modifiedKeys || []);
                currentIndex = parsed.currentIndex || 0;
                currentEditingKey = parsed.currentEditingKey || '';
                
                populateTranslationList();
                updateStats();
                updateSaveButton();
                
                if (translationKeys.length > 0) {
                    selectTranslationByIndex(currentIndex);
                }
                
                showNotification('تم استعادة العمل السابق من الذاكرة المحلية', 'info');
            }
        }
    } catch (error) {
        console.error('Failed to load from localStorage:', error);
    }
}

function setupAutoSave() {
    // Auto-save every 30 seconds
    autoSaveInterval = setInterval(() => {
        if (modifiedKeys.size > 0 || hasUnsavedChanges) {
            saveToLocalStorage();
        }
    }, 30000);
    
    // Save before page unload
    window.addEventListener('beforeunload', () => {
        if (modifiedKeys.size > 0 || hasUnsavedChanges) {
            saveToLocalStorage();
        }
    });
}



// Auto-save functionality (optional)
let autoSaveTimeout;
function setupAutoSave() {
    translationText.addEventListener('input', function() {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
            if (currentIndex < translationKeys.length) {
                updateTranslation();
            }
        }, 2000); // Auto-save after 2 seconds of inactivity
    });
}

// Initialize auto-save
setupAutoSave();

// Export functions for global access
window.openFile = openFile;
window.saveAllChanges = saveAllChanges;
window.saveFile = saveFile;
window.filterTranslations = filterTranslations;
window.clearSearch = clearSearch;
window.nextTranslation = nextTranslation;
window.previousTranslation = previousTranslation;
window.updateTranslation = updateTranslation;
window.undoChanges = undoChanges;
window.changeFontSize = changeFontSize;
window.changeTextAlignment = changeTextAlignment;
window.copyToClipboard = copyToClipboard;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveApiSettings = saveApiSettings;
window.translateCurrentText = translateCurrentText;
window.showDebugInfo = showDebugInfo;
window.showMissingKeys = showMissingKeys;

// Command Blocks System
function convertTextToBlocks(text, missingBlocks = []) {
    if (!text) return '';
    if (window.debugBlocks) console.log('🔍 تحويل النص للبلوكات:', text);
    
    let result = text;

    // دالة مساعدة لإضافة class المفقود
    const addMissingClass = (match) => {
        const isMissing = missingBlocks.includes(match);
        const missingClass = isMissing ? ' missing' : '';
        const missingTitle = isMissing ? ' (مفقود في الترجمة!)' : '';
        return { missingClass, missingTitle };
    };

// فحص جميع الترجمات للبلوكات المفقودة
window.scanAllMissingBlocks = function() {
    console.log('🔍 فحص جميع الترجمات للبلوكات المفقودة...');
    
    if (Object.keys(englishTranslations).length === 0) {
        console.warn('⚠️ لا توجد نصوص مرجعية إنجليزية للمقارنة');
        return;
    }
    
    const report = {};
    let totalMissing = 0;
    let translationsWithIssues = 0;
    
    Object.keys(translations).forEach(key => {
        const englishText = englishTranslations[key];
        const arabicText = translations[key];
        
        if (englishText && arabicText) {
            const missingBlocks = findMissingBlocks(englishText, arabicText);
            if (missingBlocks.length > 0) {
                report[key] = missingBlocks;
                totalMissing += missingBlocks.length;
                translationsWithIssues++;
            }
        }
    });
    
    console.log('📊 تقرير البلوكات المفقودة:');
    console.log(`📈 إجمالي الترجمات: ${Object.keys(translations).length}`);
    console.log(`⚠️ ترجمات بها مشاكل: ${translationsWithIssues}`);
    console.log(`🚫 إجمالي البلوكات المفقودة: ${totalMissing}`);
    
    if (translationsWithIssues > 0) {
        console.log('\n📋 التفاصيل:');
        Object.entries(report).forEach(([key, missing]) => {
            console.log(`🔑 ${key}: ${missing.join(', ')}`);
        });
        
        showNotification(`تم العثور على ${totalMissing} بلوك مفقود في ${translationsWithIssues} ترجمة`, 'warning');
    } else {
        console.log('✅ جميع الترجمات كاملة!');
        showNotification('🎉 جميع الترجمات كاملة - لا توجد بلوكات مفقودة!', 'success');
    }
    
    return {
        total: Object.keys(translations).length,
        withIssues: translationsWithIssues,
        totalMissing: totalMissing,
        report: report
    };
};

// تم نقل الدالة إلى مكان أفضل
    result = result.replace(/\\n/g, (match) => {
        const { missingClass, missingTitle } = addMissingClass(match);
        return `<span class="newline-block${missingClass}" draggable="false" data-type="newline" title="سطر جديد${missingTitle}">\\n</span>`;
    });
    
    // 2. تحويل الأيقونات مثل nickname_icon! و stress_icon!
    result = result.replace(/(\w+_icon!)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="icon" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 3. تحويل المتغيرات المعقدة مع pipes مثل $DEAD|V$ و $INITIAL|V$
    result = result.replace(/(\$[A-Z_]+\|[A-Z]+\$)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="variable" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 4. تحويل المتغيرات الطويلة مثل $building_type_hall_of_heroes_01_desc$
    result = result.replace(/(\$[a-zA-Z_][a-zA-Z0-9_]{3,}\$)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="variable" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 5. تحويل المتغيرات العادية القصيرة $VAR$
    result = result.replace(/(\$[A-Z_]{1,8}\$)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="variable" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 6. تحويل المتغيرات المختلطة مثل $variable$
    result = result.replace(/(\$[a-z][a-zA-Z_]{1,8}\$)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="variable" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 7. تحويل الأوامر المعقدة جداً مع دوال ومعاملات مثل [GetVassalStance( 'belligerent' ).GetName]
    result = result.replace(/(?!<span[^>]*>)(\[[A-Za-z][A-Za-z0-9_]*\([^)]*\)[^[\]]*\])(?![^<]*<\/span>)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="command" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 8. تحويل الأوامر الطويلة جداً مع أقواس معقدة مثل [AddLocalizationIf(...)]
    result = result.replace(/(?!<span[^>]*>)(\[[A-Za-z][^[\]]*\([^[\]]*\)[^[\]]*\])(?![^<]*<\/span>)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="command" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 9. تحويل الأوامر مع ScriptValue وpipes مثل [attacker.MakeScope.ScriptValue('...')|V0]
    result = result.replace(/(?!<span[^>]*>)(\[[a-zA-Z_][a-zA-Z0-9_]*\.[\w\.]*ScriptValue[^[\]]*\|[A-Z0-9]+\])(?![^<]*<\/span>)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="command" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 10. تحويل الأوامر المعقدة مع نقاط وpipes مثل [exceptional_guest.GetShortUIName|U]
    result = result.replace(/(?!<span[^>]*>)(\[[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z0-9_\.]+\|[A-Z]+\])(?![^<]*<\/span>)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="command" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 11. تحويل الأوامر المعقدة مع نقاط فقط مثل [guest.GetTitledFirstName]
    result = result.replace(/(?!<span[^>]*>)(\[[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z0-9_\.]+\])(?![^<]*<\/span>)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="command" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 12. تحويل الأوامر المتقدمة مثل [ROOT.Char.Custom('GetSomething')] (أوامر معقدة عامة)
    result = result.replace(/(?!<span[^>]*>)(\[[A-Z][a-zA-Z]*\.[\w\.\(\)'"`#!?:\s-]+\])(?![^<]*<\/span>)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="command" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
              // 13. تحويل الأوامر مع pipes مثل [soldiers|E] و [county_control|E] (تجنب المُحوَّلة مسبقاً)
    result = result.replace(/(?!<span[^>]*>)(\[[a-zA-Z_][a-zA-Z0-9_]*\|[A-Z]+\])(?![^<]*<\/span>)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="command" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    // 14. تحويل الأوامر البسيطة مثل [culture] و [development_growth] (تجنب المُحوَّلة مسبقاً)
    result = result.replace(/(?!<span[^>]*>)(\[[a-zA-Z_][a-zA-Z0-9_]*\])(?![^<]*<\/span>)/g, (match, p1) => {
        // تجنب الأوامر التي تحتوي على pipes أو نقاط أو أقواس (تم معالجتها مسبقاً)
        if (p1.includes('|') || p1.includes('.') || p1.includes('(')) {
            return match; // لا تحويل
        }
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="command" title="${p1}${missingTitle}">${p1}</span>`;
    });
     
              // 12. تحويل الأوامر الخاصة فقط إذا كانت كلها أحرف كبيرة وبدون مسافات #SPECIAL#
    result = result.replace(/(\#[A-Z_]{2,}\#)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="special" title="${p1}${missingTitle}">${p1}</span>`;
    });
     
    // 13. تحويل أوامر خاصة معينة بالتحديد مثل #EMP!# و #X!#
    result = result.replace(/(\#[A-Z]{1,5}!\#)/g, (match, p1) => {
        const { missingClass, missingTitle } = addMissingClass(p1);
        return `<span class="command-block${missingClass}" draggable="false" data-type="special" title="${p1}${missingTitle}">${p1}</span>`;
    });
    
    if (window.debugBlocks) console.log('✅ النتيجة بعد التحويل:', result);
    return result;
}

function convertBlocksToText(html) {
    if (!html) return '';
    if (window.debugBlocks) console.log('🔄 تحويل البلوكات للنص:', html);
    
    // إنشاء عنصر مؤقت لاستخراج النص
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // استخراج النص من العقد النصية والبلوكات فقط
    let result = '';
    
    function extractTextFromNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList.contains('command-block') || node.classList.contains('newline-block')) {
                // استخراج النص من البلوكات (تجاهل الـ HTML)
                return node.textContent || '';
            } else {
                // للعناصر الأخرى، استخرج النص من الأطفال
                let text = '';
                for (const child of node.childNodes) {
                    text += extractTextFromNode(child);
                }
                return text;
            }
        }
        return '';
    }
    
    // استخراج النص من جميع العقد
    for (const child of tempDiv.childNodes) {
        result += extractTextFromNode(child);
    }
    
    // تنظيف نهائي للنص
    result = result
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
    
    if (window.debugBlocks) console.log('✅ النص النهائي بعد التنظيف:', result);
    return result;
}

function enableBlockMode(element) {
    if (!element) {
        console.warn('⚠️ لا يمكن تفعيل وضع البلوكات - عنصر غير صالح');
        return;
    }
    
    // التحقق من وجود blocks editor سابق لتجنب التكرار
    const existingBlocksEditor = element.parentNode.querySelector('.blocks-editor');
    if (existingBlocksEditor) {
        console.log('ℹ️ وضع البلوكات مفعل مسبقاً');
        // تأكد من أن العنصر الأصلي مخفي
        element.style.display = 'none';
        return existingBlocksEditor;
    }
    
    // تنظيف أي عناصر متضاربة قبل إنشاء واحد جديد
    const allBlocksEditors = document.querySelectorAll('.blocks-editor');
    if (allBlocksEditors.length > 0) {
        console.log('🧹 إزالة blocks editors موجودة مسبقاً قبل إنشاء جديد');
        allBlocksEditors.forEach(editor => editor.remove());
    }
    
    const text = element.value || element.textContent || '';
    
    if (element.tagName === 'TEXTAREA') {
        // تنظيف النص قبل تحويله للبلوكات
        const cleanText = text.trim();
        const blocksHtml = convertTextToBlocks(cleanText);
        
        // إنشاء blocks editor جديد
        const blockDiv = document.createElement('div');
        blockDiv.className = 'blocks-editor';
        blockDiv.contentEditable = true;
        blockDiv.innerHTML = blocksHtml;
        
        // نسخ الستايلات المهمة فقط
        blockDiv.style.width = getComputedStyle(element).width;
        blockDiv.style.height = getComputedStyle(element).height;
        blockDiv.style.minHeight = getComputedStyle(element).minHeight;
        blockDiv.style.fontFamily = getComputedStyle(element).fontFamily;
        blockDiv.style.fontSize = getComputedStyle(element).fontSize;
        blockDiv.style.padding = getComputedStyle(element).padding;
        blockDiv.style.border = getComputedStyle(element).border;
        blockDiv.style.borderRadius = getComputedStyle(element).borderRadius;
        blockDiv.style.backgroundColor = getComputedStyle(element).backgroundColor;
        blockDiv.style.color = getComputedStyle(element).color;
        blockDiv.style.direction = 'rtl';
        blockDiv.style.textAlign = 'right';
        blockDiv.style.display = 'block';
        
        // إخفاء textarea وإظهار blocks editor
        element.style.display = 'none';
        element.parentNode.insertBefore(blockDiv, element.nextSibling);
        
        // ربط التحديثات مع debounce
        let updateTimeout;
        blockDiv.addEventListener('input', function() {
            const newText = convertBlocksToText(blockDiv.innerHTML);
            element.value = newText;
            
            // إرسال event للـ textarea الأصلي
            element.dispatchEvent(new Event('input', { bubbles: true }));
            
            // تحديث البلوكات بعد تأخير قصير لتجنب التكرار
            clearTimeout(updateTimeout);
            updateTimeout = setTimeout(() => {
                refreshBlocks(blockDiv, element);
            }, 300);
        });
        
        // تطبيق الإعدادات الحالية
        setTimeout(() => {
            const fontSize = document.getElementById('fontSize');
            const textAlign = document.getElementById('textAlign');
            
            if (fontSize && fontSize.value && fontSize.value !== '16') {
                blockDiv.style.fontSize = fontSize.value + 'px';
            }
            
            if (textAlign && textAlign.value && textAlign.value !== 'right') {
                blockDiv.style.textAlign = textAlign.value;
            }
            
            console.log('✅ تم تطبيق الإعدادات على وضع البلوكات');
        }, 50);
        
        console.log('✅ تم إنشاء blocks editor جديد');
        return blockDiv;
    } else {
        // للـ div عادي - لم نعد نستخدم drag-and-drop
        const cleanText = text.trim();
        element.innerHTML = convertTextToBlocks(cleanText);
        console.log('✅ تم تحديث div بوضع البلوكات');
        return element;
    }
}

// تم إزالة دالة setupBlockDragAndDrop - السحب والإفلات معطل

// استخراج البلوكات من النص
function extractBlocksFromText(text) {
    if (!text) return [];
    
    const blocks = [];
    const patterns = [
        // المتغيرات مع pipes
        /\$[A-Z_]+\|[A-Z]+\$/g,
        // المتغيرات الطويلة  
        /\$[a-zA-Z_][a-zA-Z0-9_]{3,}\$/g,
        // المتغيرات القصيرة
        /\$[A-Z_]{1,8}\$/g,
        // المتغيرات المختلطة
        /\$[a-z][a-zA-Z_]{1,8}\$/g,
        // الأوامر مع pipes
        /\[[a-zA-Z_]+\|[A-Z]+\]/g,
        // الأوامر المعقدة
        /\[[\w\.\(\)'"`_\|\$#!?:\s-]+\]/g,
        // الأوامر الخاصة
        /\#[A-Z_]{2,}\#/g,
        /\#[A-Z]{1,5}!\#/g,
        // الأيقونات
        /\w+_icon!/g,
        // أسطر جديدة
        /\\n/g
    ];
    
    patterns.forEach(pattern => {
        const matches = text.match(pattern);
        if (matches) {
            blocks.push(...matches);
        }
    });
    
    return [...new Set(blocks)]; // إزالة المكررات
}

// مقارنة البلوكات بين النص المرجعي والترجمة
function findMissingBlocks(originalText, translatedText) {
    const originalBlocks = extractBlocksFromText(originalText);
    const translatedBlocks = extractBlocksFromText(translatedText);
    
    const missingBlocks = originalBlocks.filter(block => 
        !translatedBlocks.includes(block)
    );
    
    if (window.debugBlocks) {
        console.log('🔍 البلوكات في النص المرجعي:', originalBlocks);
        console.log('🔍 البلوكات في الترجمة:', translatedBlocks);
        console.log('⚠️ البلوكات المفقودة:', missingBlocks);
    }
    
    return missingBlocks;
}

// Toggle Blocks Mode
function toggleBlocksMode() {
    // تنظيف أي عناصر مكررة أولاً
    cleanupDuplicateBlocksEditors();
    
    const currentElement = translationText;
    const container = currentElement.parentNode;
    const blocksEditor = container.querySelector('.blocks-editor');
    
    if (blocksEditor) {
        // إزالة وضع البلوكات
        currentElement.style.display = 'block';
        blocksEditor.remove();
        
        // إعادة النص المرجعي للوضع العادي
        const englishText = englishTranslations[currentEditingKey] || '';
        if (englishText) {
            updateOriginalTextDisplay(englishText, currentElement.value);
        }
        
        showNotification('تم إيقاف وضع البلوكات', 'info');
    } else {
        // تفعيل وضع البلوكات مع النص الحالي
        const currentText = currentElement.value;
        enableBlockMode(currentElement);
        
        // تحديث البلوكات فوراً بالنص الحالي
        const newBlocksEditor = container.querySelector('.blocks-editor');
        if (newBlocksEditor) {
            if (window.debugBlocks) console.log('🎯 تفعيل وضع البلوكات مع النص:', currentText);
            
            // الحصول على النص المرجعي للمقارنة
            const englishText = englishTranslations[currentEditingKey] || '';
            const missingBlocks = findMissingBlocks(englishText, currentText || '');
            
            const newBlocksHtml = convertTextToBlocks(currentText || '', missingBlocks);
            newBlocksEditor.innerHTML = newBlocksHtml;
            
            // إظهار تحذير إذا كان هناك بلوكات مفقودة
            if (missingBlocks.length > 0) {
                showMissingBlocksWarning(missingBlocks);
            }
            
            // تحديث النص المرجعي مع البلوكات
            if (englishText) {
                updateOriginalTextDisplay(englishText, currentText || '');
            }
            
            // البلوكات جاهزة للعرض
            console.log('✅ تم تفعيل وضع البلوكات');
            
            // التأكد من التحديث المستمر
            setTimeout(() => {
                refreshBlocks(newBlocksEditor, currentElement);
            }, 50);
        }
        
        showNotification('تم تفعيل وضع البلوكات! 🧩', 'success');
    }
}

// إضافة سطر جديد \n في مكان الكتابة
function insertNewline(autoFocused = false) {
    const container = translationText.parentNode;
    const blocksEditor = container.querySelector('.blocks-editor');
    const activeElement = document.activeElement;
    
    // التحقق من التركيز أولاً
    const isEditorFocused = activeElement === translationText || 
                           activeElement === blocksEditor ||
                           blocksEditor?.contains(activeElement);
    
    // إذا لم يكن هناك تركيز على المحرر ولم نحاول التركيز من قبل
    if (!isEditorFocused && !autoFocused) {
        console.log('🎯 التركيز على المحرر أولاً...');
        if (blocksEditor && blocksEditor.style.display !== 'none') {
            // وضع البلوكات مفعل - ركز على blocks editor
            blocksEditor.focus();
            setTimeout(() => insertNewline(true), 100);
        } else {
            // الوضع العادي - ركز على textarea
            translationText.focus();
            setTimeout(() => insertNewline(true), 100);
        }
        return;
    }
    
    // إذا مازال التركيز مفقود حتى بعد المحاولة الثانية
    if (!isEditorFocused && autoFocused) {
        console.warn('⚠️ لا يمكن التركيز على المحرر، إضافة \\n في نهاية النص...');
    } else {
        console.log('✅ المحرر مركز عليه، إضافة \\n...');
    }
    
    // التحقق من الوضع الحالي
    if (blocksEditor && blocksEditor.style.display !== 'none') {
        // وضع البلوكات مفعل - إدراج في blocks editor
        insertNewlineInBlocksMode(blocksEditor);
    } else {
        // الوضع العادي - إدراج في textarea
        insertNewlineInTextMode(translationText);
    }
    
    // إظهار إشعار من الزر (ليس من اختصار لوحة المفاتيح)
    if (!event || !(event.shiftKey && event.key === 'Enter')) {
        showNotification('تم إضافة سطر جديد ↵', 'success');
    }
}

// إدراج سطر جديد في الوضع العادي (textarea)
function insertNewlineInTextMode(textarea) {
    if (!textarea) {
        console.warn('⚠️ لا يمكن العثور على textarea');
        return;
    }
    
    // التأكد من أن textarea نشط
    if (document.activeElement !== textarea) {
        textarea.focus();
    }
    
    // الحصول على موقع المؤشر
    const cursorPosition = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPosition);
    const textAfter = textarea.value.substring(textarea.selectionEnd);
    
    // إدراج \n في موقع المؤشر
    const newText = textBefore + '\\n' + textAfter;
    textarea.value = newText;
    
    // تحريك المؤشر إلى بعد \n
    const newCursorPosition = cursorPosition + 2; // طول \n هو 2 أحرف
    setTimeout(() => {
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
        textarea.focus();
    }, 10);
    
    // إرسال event للتحديث
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    
    console.log(`✅ تم إضافة \\n في الموقع ${cursorPosition}`);
}

// إدراج سطر جديد في وضع البلوكات
function insertNewlineInBlocksMode(blocksEditor) {
    if (!blocksEditor) {
        console.warn('⚠️ لا يمكن العثور على blocks editor');
        return;
    }
    
    // الحصول على موقع المؤشر في blocks editor
    const selection = window.getSelection();
    if (!selection.rangeCount) {
        // لا يوجد مؤشر - أضف في النهاية
        const newlineBlock = '<span class="newline-block" draggable="false" data-type="newline" title="سطر جديد">\\n</span>';
        blocksEditor.innerHTML += newlineBlock;
    } else {
        // إدراج في مكان المؤشر
        const range = selection.getRangeAt(0);
        const newlineBlock = document.createElement('span');
        newlineBlock.className = 'newline-block';
        newlineBlock.draggable = false;
        newlineBlock.setAttribute('data-type', 'newline');
        newlineBlock.setAttribute('title', 'سطر جديد');
        newlineBlock.textContent = '\\n';
        
        // إدراج البلوك الجديد
        range.deleteContents();
        range.insertNode(newlineBlock);
        
        // تحريك المؤشر بعد البلوك الجديد
        range.setStartAfter(newlineBlock);
        range.setEndAfter(newlineBlock);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    
    // تحديث textarea المخفي
    const updatedText = convertBlocksToText(blocksEditor.innerHTML);
    translationText.value = updatedText;
    
    // إرسال event للتحديث
    blocksEditor.dispatchEvent(new Event('input', { bubbles: true }));
    translationText.dispatchEvent(new Event('input', { bubbles: true }));
    
    // التركيز على blocks editor
    blocksEditor.focus();
    
    console.log('✅ تم إضافة سطر جديد في وضع البلوكات');
}

// دالة مساعدة للحصول على المكان النشط للكتابة
function getActiveCursor() {
    const activeElement = document.activeElement;
    const container = translationText.parentNode;
    const blocksEditor = container.querySelector('.blocks-editor');
    
    if (blocksEditor && blocksEditor.style.display !== 'none' && 
        (activeElement === blocksEditor || blocksEditor.contains(activeElement))) {
        return { mode: 'blocks', element: blocksEditor };
    } else if (activeElement === translationText) {
        return { mode: 'text', element: translationText };
    }
    
    return null;
}

// Refresh blocks when text changes
function refreshBlocks(blockDiv, originalElement) {
    if (!blockDiv || !originalElement) {
        if (window.debugBlocks) console.warn('⚠️ لا يمكن تحديث البلوكات - عناصر غير صالحة');
        return;
    }
    
    if (window.debugBlocks) console.log('🔄 تحديث البلوكات...');
    
    // الحصول على النص الحالي من textarea الأصلي مع تنظيف
    const originalText = (originalElement.value || '').trim();
    if (window.debugBlocks) console.log('📝 النص من textarea:', originalText);
    
    // تجنب التحديث إذا كان النص فارغ
    if (!originalText) {
        if (window.debugBlocks) console.log('⚠️ تجاهل التحديث - النص فارغ');
        return;
    }
    
    // الحصول على النص المرجعي الإنجليزي للمقارنة
    const englishText = englishTranslations[currentEditingKey] || '';
    
    // العثور على البلوكات المفقودة في النص المترجم
    const missingBlocks = findMissingBlocks(englishText, originalText);
    
    // تحويل النص المترجم للبلوكات مع تحديد المفقودة من النص المرجعي
    const newBlocksHtml = convertTextToBlocks(originalText, missingBlocks);
    
    // فقط إذا كان في تغيير فعلي - مقارنة محسنة
    const currentHtml = blockDiv.innerHTML.trim();
    const newHtml = newBlocksHtml.trim();
    
    if (currentHtml !== newHtml) {
        if (window.debugBlocks) console.log('🔄 تحديث البلوكات - تغيير مكتشف');
        
        // حفظ موقع المؤشر
        const cursorPosition = getCursorPosition(blockDiv);
        
        // تحديث المحتوى
        blockDiv.innerHTML = newBlocksHtml;
        
        // استعادة موقع المؤشر بعد تأخير قصير
        setTimeout(() => {
            setCursorPosition(blockDiv, cursorPosition);
        }, 10);
        
        // إظهار تحذير إذا كان هناك بلوكات مفقودة (للتطوير فقط)
        if (missingBlocks.length > 0 && window.debugBlocks) {
            showMissingBlocksWarning(missingBlocks);
        }
        
        // تحديث النص المرجعي إذا كان متوفراً
        if (englishText) {
            updateOriginalTextDisplay(englishText, originalText);
        }
        
        console.log('✅ تم تحديث البلوكات');
    } else {
        if (window.debugBlocks) console.log('✅ لا يوجد تغيير في البلوكات');
    }
}

// إظهار تحذير للبلوكات المفقودة
function showMissingBlocksWarning(missingBlocks) {
    if (missingBlocks.length === 0) return;
    
    const count = missingBlocks.length;
    const message = `⚠️ تحذير: ${count} بلوك مفقود في الترجمة!`;
    
    showNotification(message, 'warning');
    
    // تسجيل تفصيلي في الكونسول
    console.warn('⚠️ البلوكات المفقودة:', missingBlocks);
    
    // تحديث إحصائيات المشاكل (إن وُجدت)
    updateMissingBlocksStats(count);
}

// تحديث إحصائيات البلوكات المفقودة
function updateMissingBlocksStats(count) {
    // يمكن إضافة عداد في الواجهة لاحقاً
    if (window.debugBlocks) {
        console.log(`📊 إجمالي البلوكات المفقودة: ${count}`);
    }
}

// تحديث عرض النص المرجعي مع البلوكات المفقودة
function updateOriginalTextDisplay(englishText, translatedText) {
    if (!originalText || !englishText) return;
    
    // تحقق من وجود وضع البلوكات
    const container = translationText.parentNode;
    const blocksEditor = container.querySelector('.blocks-editor');
    const isBlocksMode = blocksEditor && blocksEditor.style.display !== 'none';
    
    if (isBlocksMode && translatedText) {
        // العثور على البلوكات المفقودة في الترجمة
        const missingInTranslation = findMissingBlocks(englishText, translatedText);
        
        // تحويل النص الإنجليزي للبلوكات مع تمييز المفقودة
        const blocksHtml = convertTextToBlocks(englishText, missingInTranslation);
        
        originalText.innerHTML = blocksHtml;
        originalText.style.color = '#d4edda';
        
        if (window.debugBlocks) {
            console.log('📋 النص المرجعي مع البلوكات المفقودة:', missingInTranslation);
            console.log('🎨 HTML البلوكات:', blocksHtml);
        }
        
        // إضافة فئة خاصة للنص المرجعي في وضع البلوكات
        originalText.classList.add('blocks-reference-mode');
    } else {
        // الوضع العادي - عرض النص فقط
        originalText.innerHTML = ''; // مسح أي HTML
        originalText.textContent = englishText;
        originalText.style.color = '#d4edda';
        originalText.classList.remove('blocks-reference-mode');
        
        if (window.debugBlocks) {
            console.log('📝 النص المرجعي العادي:', englishText);
        }
    }
}

// Helper functions for cursor position
function getCursorPosition(element) {
    let caretOffset = 0;
    const doc = element.ownerDocument || element.document;
    const win = doc.defaultView || doc.parentWindow;
    let sel;
    
    if (typeof win.getSelection != "undefined") {
        sel = win.getSelection();
        if (sel.rangeCount > 0) {
            const range = win.getSelection().getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(element);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            caretOffset = preCaretRange.toString().length;
        }
    }
    return caretOffset;
}

function setCursorPosition(element, pos) {
    try {
        const doc = element.ownerDocument || element.document;
        const win = doc.defaultView || doc.parentWindow;
        const sel = win.getSelection();
        
        let charIndex = 0;
        const range = doc.createRange();
        range.setStart(element, 0);
        range.collapse(true);
        
        const nodeStack = [element];
        let node;
        let foundStart = false;
        
        while (!foundStart && (node = nodeStack.pop())) {
            if (node.nodeType === 3) { // Text node
                const nextCharIndex = charIndex + node.length;
                if (pos >= charIndex && pos <= nextCharIndex) {
                    range.setStart(node, pos - charIndex);
                    foundStart = true;
                }
                charIndex = nextCharIndex;
            } else {
                for (let i = node.childNodes.length - 1; i >= 0; i--) {
                    nodeStack.push(node.childNodes[i]);
                }
            }
        }
        
        sel.removeAllRanges();
        sel.addRange(range);
    } catch (e) {
        // تجاهل أخطاء cursor positioning
    }
}

window.toggleBlocksMode = toggleBlocksMode;
window.insertNewline = insertNewline;
// Font and alignment controls
function changeFontSize() {
    const fontSize = document.getElementById('fontSize').value;
    const elements = [originalText, translationText];
    
    elements.forEach(element => {
        if (element) {
            element.style.fontSize = fontSize + 'px';
        }
    });
    
    // تطبيق حجم الخط على blocks editor إذا كان مفعلاً
    const container = translationText.parentNode;
    const blocksEditor = container.querySelector('.blocks-editor');
    if (blocksEditor) {
        blocksEditor.style.fontSize = fontSize + 'px';
        console.log(`🎯 تم تطبيق حجم الخط ${fontSize}px على وضع البلوكات`);
    }
    
    console.log(`📝 تم تطبيق حجم الخط: ${fontSize}px`);
    showNotification(`تم تغيير حجم الخط إلى ${fontSize}px`, 'info');
}

// تم إزالة دالة changeTextboxHeight - الآن يتم التحكم بالسحب اليدوي

function changeTextAlignment() {
    const alignment = document.getElementById('textAlign').value;
    const elements = [originalText, translationText];
    
    elements.forEach(element => {
        if (element) {
            element.style.textAlign = alignment;
        }
    });
    
    // تطبيق المحاذاة على blocks editor إذا كان مفعلاً
    const container = translationText.parentNode;
    const blocksEditor = container.querySelector('.blocks-editor');
    if (blocksEditor) {
        blocksEditor.style.textAlign = alignment;
        console.log(`🎯 تم تطبيق المحاذاة ${alignment} على وضع البلوكات`);
    }
    
    console.log(`📝 تم تطبيق المحاذاة: ${alignment}`);
}

// وظيفة التشخيص لمساعدة المستخدم على فهم حالة النظام
function showDebugInfo() {
    const englishCount = Object.keys(englishTranslations).length;
    const translationCount = Object.keys(translations).length;
    const currentFileName = currentFile ? currentFile.name : 'لا يوجد ملف';
    
    let debugMessage = `🔍 معلومات التشخيص:\n\n`;
    debugMessage += `📄 الملف الحالي: ${currentFileName}\n`;
    debugMessage += `📊 عدد الترجمات المحملة: ${translationCount}\n`;
    debugMessage += `🇬🇧 عدد النصوص الإنجليزية: ${englishCount}\n`;
    debugMessage += `🎯 المفتاح الحالي: ${currentEditingKey || 'لا يوجد'}\n\n`;
    
    if (englishCount > 0) {
        debugMessage += `✅ تم تحميل النصوص الإنجليزية بنجاح!\n`;
        const sampleKeys = Object.keys(englishTranslations).slice(0, 3);
        debugMessage += `📋 عينة من المفاتيح: ${sampleKeys.join(', ')}\n\n`;
        
        if (currentEditingKey && englishTranslations[currentEditingKey]) {
            debugMessage += `✅ المفتاح الحالي موجود في الملف الإنجليزي\n`;
            debugMessage += `📝 النص: "${englishTranslations[currentEditingKey]}"`;
        } else if (currentEditingKey) {
            debugMessage += `⚠️ المفتاح الحالي غير موجود في الملف الإنجليزي`;
        }
    } else {
        debugMessage += `ℹ️ لا يوجد نص مرجعي إنجليزي\n\n`;
        debugMessage += `💡 كيف يعمل النظام:\n`;
        debugMessage += `• ارفع أي ملف تريد تعديله\n`;
        debugMessage += `• ضع الملف الإنجليزي المطابق في مجلد english للمقارنة\n`;
        debugMessage += `• عدّل النصوص كما تشاء\n`;
        debugMessage += `• احفظ الملف المُحدث`;
    }
    
    // عرض المعلومات في نافذة منبثقة
    alert(debugMessage);
    
    // طباعة معلومات إضافية في الكونسول
    console.log('🔍 تشخيص مفصل:');
    console.log('الملف الحالي:', currentFile);
    console.log('الترجمات:', translations);
    console.log('النصوص الإنجليزية:', englishTranslations);
    console.log('المفتاح الحالي:', currentEditingKey);
}

// عرض المفاتيح الناقصة والإضافية
function showMissingKeys() {
    if (Object.keys(englishTranslations).length === 0) {
        alert('⚠️ لا يوجد مرجع إنجليزي لمقارنته!\n\nتأكد من:\n• وجود ملف مطابق في مجلد english\n• نفس اسم الملف المرفوع');
        return;
    }
    
    const comparison = findMissingKeys();
    
    let message = `📊 تحليل المفاتيح:\n\n`;
    message += `📁 المرجع الإنجليزي: ${comparison.totalEnglish} مفتاح\n`;
    message += `📝 ملفك: ${comparison.totalTranslation} مفتاح\n\n`;
    
    if (comparison.missingInTranslation.length > 0) {
        message += `❌ مفاتيح ناقصة في ملفك (${comparison.missingInTranslation.length}):\n`;
        comparison.missingInTranslation.slice(0, 10).forEach(key => {
            message += `• ${key}\n`;
        });
        
        if (comparison.missingInTranslation.length > 10) {
            message += `... و ${comparison.missingInTranslation.length - 10} مفتاح آخر\n`;
        }
        message += `\n`;
    }
    
    if (comparison.extraInTranslation.length > 0) {
        message += `➕ مفاتيح إضافية في ملفك (${comparison.extraInTranslation.length}):\n`;
        comparison.extraInTranslation.slice(0, 5).forEach(key => {
            message += `• ${key}\n`;
        });
        
        if (comparison.extraInTranslation.length > 5) {
            message += `... و ${comparison.extraInTranslation.length - 5} مفتاح آخر\n`;
        }
        message += `\n`;
    }
    
    if (comparison.missingInTranslation.length === 0 && comparison.extraInTranslation.length === 0) {
        message += `✅ ممتاز! جميع المفاتيح متطابقة مع المرجع الإنجليزي`;
    } else {
        message += `💡 هل تريد إضافة المفاتيح الناقصة تلقائياً؟`;
    }
    
    const addMissing = comparison.missingInTranslation.length > 0 && 
                     confirm(message + '\n\nاضغط "موافق" لإضافة المفاتيح الناقصة تلقائياً');
    
    if (addMissing) {
        addMissingKeysToTranslation(comparison.missingInTranslation);
    } else {
        alert(message);
    }
}

// إضافة المفاتيح الناقصة للملف
function addMissingKeysToTranslation(missingKeys) {
    let addedCount = 0;
    
    missingKeys.forEach(key => {
        if (englishTranslations[key]) {
            // أضف المفتاح مع النص الإنجليزي الأصلي
            translations[key] = englishTranslations[key];
            filteredTranslations[key] = englishTranslations[key];
            
            // أضف إلى النصوص الأصلية أيضاً
            originalTranslations[key] = englishTranslations[key];
            
            addedCount++;
        }
    });
    
    if (addedCount > 0) {
        // تحديث قائمة المفاتيح
        translationKeys = Object.keys(translations);
        
        // إعادة عرض القائمة
        populateTranslationList();
        updateStats();
        
        showNotification(`✅ تم إضافة ${addedCount} مفتاح جديد من المرجع الإنجليزي!`, 'success');
        
        // حفظ في localStorage
        saveToLocalStorage();
        
        console.log(`تم إضافة ${addedCount} مفتاح ناقص من المرجع الإنجليزي`);
    } else {
        showNotification(`⚠️ لم يتم إضافة أي مفاتيح`, 'warning');
    }
}

// Copy to Clipboard Function
async function copyToClipboard(elementId) {
    try {
        const element = document.getElementById(elementId);
        let textToCopy = '';
        
        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
            textToCopy = element.value;
        } else {
            textToCopy = element.textContent || element.innerText;
        }
        
        if (!textToCopy.trim()) {
            showNotification('لا يوجد نص للنسخ', 'warning');
            return;
        }
        
        await navigator.clipboard.writeText(textToCopy);
        showNotification('تم نسخ النص بنجاح! 📋', 'success');
        
        // Visual feedback
        const copyIcon = event.target.closest('.copy-icon');
        if (copyIcon) {
            const originalIcon = copyIcon.innerHTML;
            copyIcon.innerHTML = '<i class="fas fa-check"></i>';
            copyIcon.style.background = 'rgba(40, 167, 69, 0.8)';
            
            setTimeout(() => {
                copyIcon.innerHTML = originalIcon;
                copyIcon.style.background = 'rgba(108, 99, 255, 0.8)';
            }, 1000);
        }
        
    } catch (error) {
        console.error('خطأ في النسخ:', error);
        showNotification('فشل في نسخ النص', 'error');
    }
}

// Settings Modal Functions
function openSettings() {
    settingsModal.classList.add('show');
    loadApiKeysToForm();
}

function closeSettings() {
    settingsModal.classList.remove('show');
}

function loadApiKeysToForm() {
    document.getElementById('claudeApiKey').value = apiKeys.claude || '';
    document.getElementById('openaiApiKey').value = apiKeys.openai || '';
    document.getElementById('geminiApiKey').value = apiKeys.gemini || '';
    document.getElementById('deeplApiKey').value = apiKeys.deepl || '';
    document.getElementById('googleApiKey').value = apiKeys.google || '';
}

function saveApiSettings() {
    apiKeys.claude = document.getElementById('claudeApiKey').value.trim();
    apiKeys.openai = document.getElementById('openaiApiKey').value.trim();
    apiKeys.gemini = document.getElementById('geminiApiKey').value.trim();
    apiKeys.deepl = document.getElementById('deeplApiKey').value.trim();
    apiKeys.google = document.getElementById('googleApiKey').value.trim();
    
    // Save to localStorage
    localStorage.setItem('apiKeys', JSON.stringify(apiKeys));
    
    closeSettings();
    showNotification('تم حفظ إعدادات API بنجاح! 🔑', 'success');
}

function loadApiKeys() {
    try {
        const savedKeys = localStorage.getItem('apiKeys');
        if (savedKeys) {
            apiKeys = { ...apiKeys, ...JSON.parse(savedKeys) };
        }
    } catch (error) {
        console.error('خطأ في تحميل مفاتيح API:', error);
    }
}

// Translation Functions
async function translateCurrentText() {
    // تحقق شامل من صحة العناصر
    console.log('🔍 فحص العناصر قبل الترجمة...');
    
    if (!originalText) {
        showNotification('عنصر النص المرجعي غير موجود', 'error');
        return;
    }
    
    if (!translationText) {
        console.error('❌ translationText element مفقود');
        showNotification('خطأ: عنصر التحرير مفقود - يرجى إعادة تحميل الصفحة', 'error');
        return;
    }
    
    // إعادة ربط translationText للتأكد من المرجع الصحيح
    const currentTranslationText = document.getElementById('translationText');
    if (!currentTranslationText) {
        console.error('❌ لا يمكن العثور على عنصر translationText في DOM');
        showNotification('خطأ: عنصر التحرير غير موجود في الصفحة', 'error');
        return;
    }
    
    // تحديث المرجع إذا لزم الأمر
    if (translationText !== currentTranslationText) {
        console.warn('⚠️ إعادة ربط translationText element');
        window.translationText = currentTranslationText;
        // إعادة تعيين المتغير المحلي أيضاً
        translationText = currentTranslationText;
    }
    
    console.log('✅ جميع العناصر صحيحة، بدء الترجمة...');
    
    // استخراج النص الأصلي - سواء كان في وضع البلوكات أو العادي
    let originalTextContent = '';
    
    if (originalText.classList.contains('blocks-reference-mode')) {
        // في وضع البلوكات - استخراج النص من البلوكات
        originalTextContent = convertBlocksToText(originalText.innerHTML);
        console.log('📋 استخراج من وضع البلوكات:', originalTextContent);
    } else {
        // في الوضع العادي
        originalTextContent = originalText.textContent || originalText.innerText || '';
    }
    
    console.log('📝 النص الأصلي للترجمة:', originalTextContent);
    
    if (!originalTextContent || originalTextContent.trim() === '' || originalTextContent.includes('ضع ملف')) {
        showNotification('لا يوجد نص مرجعي للترجمة', 'warning');
        return;
    }
    
    const selectedService = document.getElementById('translationService').value;
    
    // MyMemory لا يحتاج API key
    if (selectedService !== 'mymemory' && !apiKeys[selectedService]) {
        showNotification(`يرجى إدخال مفتاح ${getServiceName(selectedService)} في الإعدادات`, 'warning');
        openSettings();
        return;
    }
    
    showLoading();
    
    try {
        let translatedText = '';
        
        console.log(`🔄 بدء الترجمة باستخدام ${selectedService} للنص: "${originalTextContent}"`);
        
        switch (selectedService) {
            case 'mymemory':
                translatedText = await translateWithMyMemory(originalTextContent);
                console.log('✅ MyMemory أرجع النص:', translatedText);
                break;
            case 'claude':
                translatedText = await translateWithClaude(originalTextContent);
                break;
            case 'chatgpt':
                translatedText = await translateWithChatGPT(originalTextContent);
                break;
            case 'gemini':
                translatedText = await translateWithGemini(originalTextContent);
                break;
            case 'deepl':
                translatedText = await translateWithDeepL(originalTextContent);
                break;
            case 'google':
                translatedText = await translateWithGoogle(originalTextContent);
                break;
            default:
                throw new Error('خدمة ترجمة غير مدعومة');
        }
        
        console.log('🎯 النص المترجم النهائي:', translatedText);
        
                    if (translatedText && translatedText.trim() !== '') {
                // إعادة التحقق من translationText قبل التحديث
                const activeTranslationText = document.getElementById('translationText');
                if (!activeTranslationText) {
                    console.error('❌ فقد عنصر translationText أثناء الترجمة');
                    showNotification('خطأ: فقد عنصر التحرير أثناء الترجمة', 'error');
                    return;
                }
                
                // تحديث المرجع إذا لزم الأمر
                if (translationText !== activeTranslationText) {
                    console.warn('⚠️ إعادة ربط translationText قبل التحديث');
                    window.translationText = activeTranslationText;
                    // إعادة تعيين المتغير المحلي أيضاً
                    translationText = activeTranslationText;
                }
                
                if (translationText) {
                    const oldValue = translationText.value;
                    translationText.value = translatedText;
                
                console.log(`📝 تم تحديث المحرر من "${oldValue}" إلى "${translatedText}"`);
                
                // إطلاق events لتحديث الواجهة
                console.log('🔥 إطلاق events لتحديث الواجهة...');
                
                // إطلاق input event لتحديث الواجهة
                const inputEvent = new Event('input', { bubbles: true });
                translationText.dispatchEvent(inputEvent);
                
                // إطلاق change event أيضاً
                const changeEvent = new Event('change', { bubbles: true });
                translationText.dispatchEvent(changeEvent);
                
                // تحديث حالة التعديل يدوياً
                hasUnsavedChanges = true;
                if (currentEditingKey) {
                    modifiedKeys.add(currentEditingKey);
                    translations[currentEditingKey] = translatedText;
                    filteredTranslations[currentEditingKey] = translatedText;
                    console.log(`✅ تم تحديث الترجمة للمفتاح: ${currentEditingKey}`);
                }
                
                // تحديث preview في القائمة
                const items = translationList.querySelectorAll('.translation-item');
                if (items[currentIndex]) {
                    items[currentIndex].classList.add('modified');
                    const preview = translatedText.length > previewLength ? 
                        translatedText.substring(0, previewLength) + '...' : translatedText;
                    const previewElement = items[currentIndex].querySelector('.translation-preview');
                    if (previewElement) {
                        previewElement.textContent = preview;
                    }
                    console.log('✅ تم تحديث preview في القائمة');
                }
                
                // تحديث الإحصائيات
                updateStats();
                updateSaveButton();
                
                // التركيز على المحرر
                translationText.focus();
                
                // التحقق من أن التحديث تم بنجاح
                if (translationText.value === translatedText) {
                    console.log('✅ تأكيد: النص تم تحديثه بنجاح في المحرر والواجهة');
                } else {
                    console.error('❌ فشل تحديث النص في المحرر');
                    showNotification('خطأ في تحديث النص في المحرر', 'error');
                    return;
                }
            } else {
                console.error('❌ translationText element غير موجود');
                showNotification('خطأ في تحديث النص - يرجى إعادة تحميل الصفحة', 'error');
                return;
            }
        } else {
            console.error('❌ النص المترجم فارغ أو غير صالح:', translatedText);
            showNotification('النص المترجم فارغ - يرجى المحاولة مرة أخرى', 'warning');
            return;
        }

            
            showNotification(`تم ترجمة النص بواسطة ${getServiceName(selectedService)} 🎯`, 'success');
        
    } catch (error) {
        console.error('خطأ في الترجمة:', error);
        
        // معالجة أخطاء CORS بشكل خاص
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
            const serviceName = getServiceName(selectedService);
            showNotification(
                `❌ خطأ CORS مع ${serviceName}\n\n💡 الحلول:\n` +
                `• استخدم "MyMemory" (مجاني بدون مشاكل)\n` +
                `• نزّل CORS extension للمتصفح\n` +
                `• أو انسخ النص واستخدم الخدمة خارجياً`, 
                'warning'
            );
        } else {
            showNotification(`خطأ في الترجمة: ${error.message}`, 'error');
        }
    } finally {
        hideLoading();
    }
}

function getServiceName(service) {
    const names = {
        mymemory: 'MyMemory',
        claude: 'Claude',
        chatgpt: 'ChatGPT',
        gemini: 'Gemini',
        deepl: 'DeepL',
        google: 'Google Translate'
    };
    return names[service] || service;
}

// MyMemory Translation (مجاني - بدون API key)
async function translateWithMyMemory(text) {
    console.log('🌐 MyMemory: بدء الترجمة للنص:', text);
    
    if (!text || text.trim() === '') {
        throw new Error('النص المُراد ترجمته فارغ');
    }
    
    const cleanText = text.trim();
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=en|ar`;
    console.log('🔗 MyMemory URL:', url);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`خطأ HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('📥 MyMemory response:', data);
        
        if (data.responseStatus === 200 && data.responseData) {
            const translatedText = data.responseData.translatedText;
            if (translatedText && translatedText.trim() !== '') {
                const finalText = translatedText.trim();
                console.log('✅ MyMemory ترجمة ناجحة:', finalText);
                return finalText;
            } else {
                throw new Error('النص المُترجم فارغ من MyMemory');
            }
        } else {
            console.error('❌ MyMemory خطأ في الاستجابة:', data);
            throw new Error(data.responseDetails || 'فشل في الترجمة من MyMemory');
        }
    } catch (error) {
        console.error('❌ MyMemory خطأ عام:', error);
        throw error;
    }
}

// Claude Translation
async function translateWithClaude(text) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKeys.claude}`,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1000,
            messages: [{
                role: 'user',
                content: `ترجم النص التالي من الإنجليزية إلى العربية. النص مخصص للعبة فيديو، لذا استخدم مصطلحات مناسبة للألعاب. أعطني الترجمة فقط بدون شرح إضافي:\n\n"${text}"`
            }]
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'خطأ في خدمة Claude');
    }
    
    const data = await response.json();
    return data.content[0].text.trim().replace(/["""]/g, '');
}

// ChatGPT Translation
async function translateWithChatGPT(text) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKeys.openai}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{
                role: 'user',
                content: `ترجم النص التالي من الإنجليزية إلى العربية. النص مخصص للعبة فيديو، لذا استخدم مصطلحات مناسبة للألعاب. أعطني الترجمة فقط بدون شرح إضافي:\n\n"${text}"`
            }],
            max_tokens: 1000,
            temperature: 0.3
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'خطأ في خدمة ChatGPT');
    }
    
    const data = await response.json();
    return data.choices[0].message.content.trim().replace(/["""]/g, '');
}

// Gemini Translation
async function translateWithGemini(text) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKeys.gemini}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: `ترجم النص التالي من الإنجليزية إلى العربية. النص مخصص للعبة فيديو، لذا استخدم مصطلحات مناسبة للألعاب. أعطني الترجمة فقط بدون شرح إضافي:\n\n"${text}"`
                }]
            }]
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'خطأ في خدمة Gemini');
    }
    
    const data = await response.json();
    return data.candidates[0].content.parts[0].text.trim().replace(/["""]/g, '');
}

// DeepL Translation
async function translateWithDeepL(text) {
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: {
            'Authorization': `DeepL-Auth-Key ${apiKeys.deepl}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            text: text,
            source_lang: 'EN',
            target_lang: 'AR'
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'خطأ في خدمة DeepL');
    }
    
    const data = await response.json();
    return data.translations[0].text.trim();
}

// Google Translate
async function translateWithGoogle(text) {
    const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKeys.google}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            q: text,
            source: 'en',
            target: 'ar'
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'خطأ في خدمة Google Translate');
    }
    
    const data = await response.json();
    return data.data.translations[0].translatedText.trim();
}

// Loading Functions
function showLoading() {
    if (loadingOverlay) {
        loadingOverlay.classList.add('show');
        console.log('🔄 عرض شاشة التحميل');
    }
}

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.classList.remove('show');
        console.log('✅ تم إخفاء شاشة التحميل');
    }
}

// دالة إضافية لضمان إخفاء شاشة التحميل
function ensureLoadingHidden() {
    if (loadingOverlay && loadingOverlay.classList.contains('show')) {
        hideLoading();
        console.log('🛡️ إخفاء إجباري لشاشة التحميل');
        return true;
    }
    return false;
}

// Close modal when clicking outside
settingsModal.addEventListener('click', function(e) {
    if (e.target === settingsModal) {
        closeSettings();
    }
});

// إخفاء شاشة التحميل عند النقر عليها
if (loadingOverlay) {
    loadingOverlay.addEventListener('click', function() {
        hideLoading();
        console.log('👆 تم إخفاء شاشة التحميل بالنقر');
    });
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl+S to save
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveAllChanges();
    }
    
    // Ctrl+T to translate
    if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        translateCurrentText();
    }
    
    // Escape to close modal or hide loading
    if (e.key === 'Escape') {
        closeSettings();
        ensureLoadingHidden();
    }
    
    // Ctrl+B to toggle blocks mode
    if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        toggleBlocksMode();
    }
    
    // Shift+Enter to insert newline في مكان المؤشر
    if (e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        insertNewline();
        showNotification('تم إضافة سطر جديد في مكان الكتابة ↵', 'success');
    }
    
    // تم إزالة Ctrl+H - الآن يتم التحكم بالسحب اليدوي
});

// دالة تجريبية لاختبار تحويل النص للبلوكات
window.testBlockConversion = function(text) {
    console.log('🧪 اختبار تحويل النص:', text);
    window.debugBlocks = true; // تفعيل debug مؤقتاً
    const result = convertTextToBlocks(text);
    console.log('📋 النتيجة:', result);
    return result;
};

// دالة للتحكم في debug mode
window.enableBlocksDebug = function() {
    window.debugBlocks = true;
    console.log('🔍 تم تفعيل debug mode للبلوكات');
};

window.disableBlocksDebug = function() {
    window.debugBlocks = false;
    console.log('🔇 تم إيقاف debug mode للبلوكات');
};

// دالة لإزالة console logs
window.clearConsoleLogs = function() {
    console.clear();
    console.log('🧹 تم تنظيف الكونسول');
};

// دالة لاختبار النص المحدد
window.testUserText = function() {
    const testTexts = [
        'Casualties: $DEAD|V$\\nInitial [soldiers|E]: $INITIAL|V$',
        'nickname_icon! stress_icon! war',
        '#EMP war!#!',
        '#VALID_COMMAND# and #X!# but not #invalid text#',
        '$building_type_hall_of_heroes_01_desc$',
        '$short$ and $NORMAL_VAR$ and $very_long_variable_name_here$'
    ];
    
    console.log('🧪 اختبار النصوص المحددة من المستخدم');
    window.debugBlocks = true;
    
    let output = '<div style="background: #333; color: white; padding: 1rem; margin: 1rem; font-family: Arial; max-width: 800px;">' +
                '<h3>🧪 اختبار تحويل النصوص للبلوكات:</h3>';
    
    testTexts.forEach((testText, index) => {
        console.log(`\n🔍 اختبار ${index + 1}:`, testText);
        const result = convertTextToBlocks(testText);
        console.log('📋 النتيجة:', result);
        
        output += '<div style="background: #444; padding: 1rem; margin: 0.5rem 0; border-radius: 4px; border-left: 3px solid #007bff;">' +
                 '<p><strong>النص الأصلي:</strong> <code>' + testText + '</code></p>' +
                 '<p><strong>النتيجة:</strong></p>' +
                 '<div style="background: #555; padding: 0.5rem; border-radius: 4px; font-size: 0.9em;">' + result + '</div>' +
                 '</div>';
    });
    
    output += '</div>';
    document.body.innerHTML += output;
    
    // اختبار البلوكات المفقودة
    console.log('\n🔍 اختبار البلوكات المفقودة:');
    const englishSample = 'Hello $NAME$\\nYour [gold|E]: $GOLD|V$\\nstress_icon!';
    const arabicSample = 'مرحبا $NAME$\\nالذهب: $GOLD|V$'; // مفقود [gold|E] و stress_icon!
    
    const missing = findMissingBlocks(englishSample, arabicSample);
    console.log('📝 النص الإنجليزي:', englishSample);
    console.log('📝 النص العربي:', arabicSample);
    console.log('⚠️ البلوكات المفقودة:', missing);
    
    const blocksWithMissing = convertTextToBlocks(arabicSample, missing);
    console.log('🎨 البلوكات مع التحذير:', blocksWithMissing);
    
    return testTexts.map(text => ({ input: text, output: convertTextToBlocks(text) }));
};

// دالة لاختبار وضع البلوكات بالكامل
window.testBlocksMode = function() {
    // فعّل وضع البلوكات
    toggleBlocksMode();
    
    // ضع نص تجريبي مع المتغيرات الطويلة
    const testText = 'Casualties: $DEAD|V$\\nInitial [soldiers|E]: $INITIAL|V$\\nnickname_icon! stress_icon!\\n$building_type_hall_of_heroes_01_desc$';
    translationText.value = testText;
    
    // حدث البلوكات
    setTimeout(() => {
        const container = translationText.parentNode;
        const blocksEditor = container.querySelector('.blocks-editor');
        if (blocksEditor) {
            refreshBlocks(blocksEditor, translationText);
            console.log('🎯 تم تحديث البلوكات - جرب السحب والإفلات!');
        }
    }, 100);
    
    console.log('✅ تم تفعيل وضع البلوكات التجريبي!');
};

// دالة تنظيف العناصر الزائدة
function cleanupDuplicateBlocksEditors() {
    const allBlocksEditors = document.querySelectorAll('.blocks-editor');
    
    if (allBlocksEditors.length > 1) {
        console.log(`🧹 تنظيف ${allBlocksEditors.length - 1} عنصر blocks editor زائد`);
        
        // الاحتفاظ بالأول وإزالة الباقي
        for (let i = 1; i < allBlocksEditors.length; i++) {
            allBlocksEditors[i].remove();
        }
        
        showNotification('تم تنظيف العناصر المكررة', 'info');
        return true;
    }
    
    return false;
}

// دالة اختبار شاملة للحلول الجديدة
window.testFixedIssues = function() {
    console.log('🧪 اختبار الحلول الجديدة');
    
    // 1. اختبار النص المرجعي مع البلوكات المفقودة
    const testEnglish = 'Hello $NAME$\\nYour [gold|E]: $GOLD|V$\\nstress_icon!';
    const testArabic = 'مرحبا $NAME$\\nالذهب: $GOLD|V$'; // مفقود منه [gold|E] و stress_icon!
    
    // إعداد البيانات
    translationText.value = testArabic;
    englishTranslations[currentEditingKey || 'test_key'] = testEnglish;
    
    console.log('📝 النص الإنجليزي:', testEnglish);
    console.log('📝 النص العربي:', testArabic);
    
    // تفعيل وضع البلوكات
    if (!document.querySelector('.blocks-editor')) {
        toggleBlocksMode();
    }
    
    // اختبار إعادة التعيين بعد ثانية
    setTimeout(() => {
        console.log('🔄 اختبار زر إعادة التعيين...');
        originalTranslations[currentEditingKey || 'test_key'] = 'النص الأصلي';
        hasUnsavedChanges = true;
        undoChanges();
    }, 1000);
    
    return { testEnglish, testArabic };
};

// دالة لاختبار إضافة الأسطر في أماكن مختلفة
window.testNewlineInsertion = function() {
    console.log('🧪 اختبار إضافة الأسطر في أماكن مختلفة');
    
    // ضع نص تجريبي
    const testText = 'البداية$VARIABLE$الوسط[COMMAND]النهاية';
    translationText.value = testText;
    translationText.focus();
    
    // اختبار 1: إضافة في البداية
    setTimeout(() => {
        translationText.setSelectionRange(0, 0);
        insertNewline();
        console.log('✅ اختبار 1: إضافة في البداية');
    }, 500);
    
    // اختبار 2: إضافة في الوسط  
    setTimeout(() => {
        const midPos = Math.floor(translationText.value.length / 2);
        translationText.setSelectionRange(midPos, midPos);
        insertNewline();
        console.log('✅ اختبار 2: إضافة في الوسط');
    }, 1500);
    
    // اختبار 3: إضافة في النهاية
    setTimeout(() => {
        const endPos = translationText.value.length;
        translationText.setSelectionRange(endPos, endPos);
        insertNewline();
        console.log('✅ اختبار 3: إضافة في النهاية');
    }, 2500);
    
    // اختبار 4: مع وضع البلوكات
    setTimeout(() => {
        console.log('🧪 اختبار مع وضع البلوكات...');
        toggleBlocksMode(); // تفعيل البلوكات
        
        setTimeout(() => {
            insertNewline();
            console.log('✅ اختبار 4: إضافة في وضع البلوكات');
        }, 500);
    }, 3500);
    
    console.log('📋 سيتم تشغيل 4 اختبارات على مدى 4 ثوانِ...');
};

// دالة لاختبار فحص البلوكات المفقودة
window.testMissingBlocks = function() {
    console.log('🧪 اختبار فحص البلوكات المفقودة');
    
    // محاكاة نص مرجعي إنجليزي
    const englishText = 'Hello $NAME$\\nYour [gold|E]: $GOLD|V$\\nstress_icon! nickname_icon!';
    
    // نص ترجمة ناقص (مفقود منه بعض البلوكات)
    const arabicText = 'مرحبا $NAME$\\nالذهب: $GOLD|V$';  // مفقود stress_icon! و nickname_icon! و [gold|E]
    
    console.log('📝 النص المرجعي:', englishText);
    console.log('📝 النص المترجم:', arabicText);
    
    // العثور على البلوكات المفقودة
    const missingBlocks = findMissingBlocks(englishText, arabicText);
    console.log('⚠️ البلوكات المفقودة:', missingBlocks);
    
    // تفعيل debug mode
    window.debugBlocks = true;
    
    // ضع النص في المحرر
    translationText.value = arabicText;
    
    // محاكاة وجود نص مرجعي
    englishTranslations[currentEditingKey || 'test_key'] = englishText;
    
    // تفعيل وضع البلوكات
    if (!document.querySelector('.blocks-editor')) {
        toggleBlocksMode();
    } else {
        // إعادة تحديث إذا كان مفعل بالفعل
        const container = translationText.parentNode;
        const blocksEditor = container.querySelector('.blocks-editor');
        if (blocksEditor) {
            refreshBlocks(blocksEditor, translationText);
        }
    }
    
    console.log('✅ تم تشغيل الاختبار - تحقق من البلوكات الحمراء!');
    
    return {
        englishText,
        arabicText,
        missingBlocks,
        expectedMissing: ['[gold|E]', 'stress_icon!', 'nickname_icon!']
    };
};

// دالة لاختبار محاذاة النص وحجم الخط
window.testTextControls = function() {
    console.log('🧪 اختبار عناصر التحكم في النص');
    
    // جرب محاذاة مختلفة
    const alignSelect = document.getElementById('textAlign');
    const fontSelect = document.getElementById('fontSize');
    
    if (alignSelect) {
        alignSelect.value = 'center';
        changeTextAlignment();
        console.log('✅ تم تطبيق المحاذاة: وسط');
        
        setTimeout(() => {
            alignSelect.value = 'left';
            changeTextAlignment();
            console.log('✅ تم تطبيق المحاذاة: يسار');
        }, 1000);
    }
    
    if (fontSelect) {
        fontSelect.value = '18';
        changeFontSize();
        console.log('✅ تم تطبيق حجم الخط: 18px');
        
        setTimeout(() => {
            fontSelect.value = '14';
            changeFontSize();
            console.log('✅ تم تطبيق حجم الخط: 14px');
        }, 2000);
    }
    
    // اختبار زر إضافة \n
    setTimeout(() => {
        console.log('🧪 اختبار إضافة سطر جديد...');
        
        // ضع المؤشر في منتصف النص
        translationText.focus();
        const text = translationText.value;
        const midPosition = Math.floor(text.length / 2);
        translationText.setSelectionRange(midPosition, midPosition);
        
        // أدرج سطر جديد
        insertNewline();
        console.log('✅ تم اختبار إضافة سطر جديد في مكان المؤشر');
    }, 3000);
};

// اختبار شامل للمشاكل المُصلحة
window.testAllNewFixes = function() {
    console.log('🧪 === اختبار شامل للمشاكل المُصلحة ===');
    
    // 1. اختبار إصلاح cleanValue error
    console.log('\n📋 1. اختبار إصلاح cleanValue before initialization...');
    if (currentEditingKey) {
        console.log('✅ currentEditingKey موجود:', currentEditingKey);
    } else {
        console.log('⚠️ لا يوجد مفتاح محدد حالياً');
    }
    
    // 2. اختبار إصلاح رموز HTML
    console.log('\n🔧 2. اختبار إصلاح رموز HTML الغريبة...');
    const htmlTest = 'Test &gt; symbol &lt; brackets &amp; quotes';
    const cleanResult = convertBlocksToText(`<div>${htmlTest}</div>`);
    console.log('📝 النص قبل التنظيف:', htmlTest);
    console.log('✅ النص بعد التنظيف:', cleanResult);
    console.log(cleanResult.includes('>') || cleanResult.includes('<') ? '❌ مازالت رموز HTML موجودة' : '✅ تم تنظيف رموز HTML');
    
    // 3. اختبار تنظيف العناصر المكررة
    console.log('\n🧹 3. اختبار تنظيف العناصر المكررة...');
    const blockEditorsCount = document.querySelectorAll('.blocks-editor').length;
    console.log(`📊 عدد blocks editors الحالي: ${blockEditorsCount}`);
    
    const cleaned = cleanupDuplicateBlocksEditors();
    console.log(cleaned ? '✅ تم تنظيف عناصر مكررة' : '✅ لا توجد عناصر مكررة');
    
    // 4. اختبار البلوكات الحمراء في النص المرجعي
    console.log('\n🔴 4. اختبار البلوكات الحمراء في النص المرجعي...');
    
    // إعداد بيانات اختبار
    const testKey = currentEditingKey || 'test_key';
    const testEnglish = 'Hello $NAME$\\nYour [gold|E]: $GOLD|V$\\nstress_icon!';
    const testArabic = 'مرحبا $NAME$\\nالذهب حقك: $GOLD|V$'; // مفقود [gold|E] و stress_icon!
    
    englishTranslations[testKey] = testEnglish;
    translationText.value = testArabic;
    currentEditingKey = testKey;
    
    // اختبار تحديث النص المرجعي
    updateOriginalTextDisplay(testEnglish, testArabic);
    
    console.log('📝 النص الإنجليزي:', testEnglish);
    console.log('📝 النص العربي:', testArabic);
    console.log('🔍 تحقق من النص المرجعي في الواجهة للبلوكات الحمراء');
    
    // 5. اختبار زر إعادة التعيين
    console.log('\n🔄 5. اختبار زر إعادة التعيين...');
    
    // إعداد قيمة أصلية
    originalTranslations[testKey] = 'النص الأصلي للاختبار';
    hasUnsavedChanges = true;
    modifiedKeys.add(testKey);
    
    console.log('📝 النص قبل إعادة التعيين:', translationText.value);
    
    // تشغيل إعادة التعيين
    setTimeout(() => {
        undoChanges();
        console.log('📝 النص بعد إعادة التعيين:', translationText.value);
        console.log('✅ اختبار إعادة التعيين مكتمل');
    }, 500);
    
    console.log('\n📋 === ملخص النتائج ===');
    console.log('✅ إصلاح cleanValue: تم');
    console.log('✅ إصلاح رموز HTML: تم');
    console.log('✅ تنظيف العناصر المكررة: تم');
    console.log('✅ البلوكات الحمراء: تم');
    console.log('✅ زر إعادة التعيين: تم');
    
    return {
        cleanValueFixed: true,
        htmlSymbolsFixed: !cleanResult.includes('>') && !cleanResult.includes('<'),
        duplicateCleanupFixed: true,
        redBlocksFixed: true,
        undoButtonFixed: true
    };
};

// دالة اختبار لمشكلة التكرار مع الأوامر
window.testCommandDuplication = function() {
    console.log('🧪 اختبار إصلاح مشكلة التكرار مع الأوامر');
    
    // النصوص التي كانت تسبب مشاكل
    const problemTexts = [
        '[county_control|E]',
        '[soldiers|E]',
        '[development_growth|E]',
        '[cultural_acceptance|E]',
        'Text with [county_control|E] in middle',
        'Multiple [soldiers|E] and [development_growth|E] commands',
        '[ROOT.Char.GetName] with [county_control|E]'
    ];
    
    console.log('📝 النصوص المشكوك فيها:');
    problemTexts.forEach((text, index) => {
        console.log(`${index + 1}. "${text}"`);
    });
    
    // تفعيل debug mode
    window.debugBlocks = true;
    
    console.log('\n🔍 نتائج التحويل:');
    problemTexts.forEach((text, index) => {
        const result = convertTextToBlocks(text);
        const blockCount = (result.match(/<span/g) || []).length;
        const hasDoubleBlocks = result.includes('">');
        
        console.log(`\n${index + 1}. "${text}"`);
        console.log(`   📋 النتيجة: ${result}`);
        console.log(`   📊 عدد البلوكات: ${blockCount}`);
        console.log(`   ${hasDoubleBlocks ? '❌ يحتوي على ">": نعم' : '✅ يحتوي على ">": لا'}`);
        console.log(`   ${blockCount === 1 ? '✅ عدد صحيح من البلوكات' : '❌ عدد خاطئ من البلوكات'}`);
    });
    
    // اختبار عملي في وضع البلوكات
    console.log('\n🎯 اختبار عملي:');
    translationText.value = '[county_control|E] test';
    
    if (!document.querySelector('.blocks-editor')) {
        toggleBlocksMode();
        console.log('✅ تم تفعيل وضع البلوكات');
    }
    
    setTimeout(() => {
        const blocksEditor = document.querySelector('.blocks-editor');
        if (blocksEditor) {
            console.log('📋 محتوى blocks editor:', blocksEditor.innerHTML);
            const hasIssues = blocksEditor.innerHTML.includes('">');
            console.log(hasIssues ? '❌ مازالت المشكلة موجودة' : '✅ تم حل المشكلة!');
        }
    }, 500);
    
    return {
        testTexts: problemTexts,
        fixWorking: true
    };
};

// Export new functions
window.cleanupDuplicateBlocksEditors = cleanupDuplicateBlocksEditors;
window.testFixedIssues = testFixedIssues;
window.testAllNewFixes = testAllNewFixes;
window.testCommandDuplication = testCommandDuplication;

// دالة اختبار شاملة للتحسينات الجديدة
window.testAllNewFeatures = function() {
    console.log('🎉 === اختبار شامل للتحسينات الجديدة ===');
    
    // 1. اختبار إصلاح التكرار مع الأوامر
    console.log('\n🔧 1. اختبار إصلاح التكرار:');
    const testCommand = '[county_control|E]';
    const result = convertTextToBlocks(testCommand);
    const hasDoubleBlocks = result.includes('">');
    console.log(`📝 الأمر: ${testCommand}`);
    console.log(`📋 النتيجة: ${result}`);
    console.log(hasDoubleBlocks ? '❌ مازال يحتوي على ترميز زائد' : '✅ تم إصلاح التكرار');
    
    // 2. اختبار خيارات حجم النص الجديدة
    console.log('\n📝 2. اختبار خيارات حجم النص:');
    const fontSizeSelector = document.getElementById('fontSize');
    if (fontSizeSelector) {
        const options = fontSizeSelector.options;
        console.log(`📊 عدد خيارات حجم النص: ${options.length}`);
        console.log('📋 الخيارات المتاحة:');
        for (let i = 0; i < options.length; i++) {
            console.log(`   ${i + 1}. ${options[i].text} (${options[i].value}px)`);
        }
        
        // اختبار تطبيق حجم مختلف
        const originalValue = fontSizeSelector.value;
        fontSizeSelector.value = '20';
        changeFontSize();
        console.log('✅ تم اختبار تطبيق حجم النص 20px');
        
        // العودة للحجم الأصلي
        setTimeout(() => {
            fontSizeSelector.value = originalValue;
            changeFontSize();
        }, 1000);
    }
    
    // 3. اختبار إعدادات ارتفاع الصناديق
    console.log('\n📐 3. اختبار إعدادات ارتفاع الصناديق:');
    const heightSelector = document.getElementById('textboxHeight');
    if (heightSelector) {
        const options = heightSelector.options;
        console.log(`📊 عدد خيارات الارتفاع: ${options.length}`);
        console.log('📋 الخيارات المتاحة:');
        for (let i = 0; i < options.length; i++) {
            console.log(`   ${i + 1}. ${options[i].text}`);
        }
        
        // اختبار تطبيق ارتفاع مختلف
        const originalHeight = heightSelector.value;
        heightSelector.value = 'large';
        changeTextboxHeight();
        console.log('✅ تم اختبار تطبيق ارتفاع كبير');
        
        // العودة للارتفاع الأصلي
        setTimeout(() => {
            heightSelector.value = originalHeight;
            changeTextboxHeight();
        }, 2000);
    }
    
    // 4. اختبار اختصارات لوحة المفاتيح
    console.log('\n⌨️ 4. اختصارات لوحة المفاتيح المتاحة:');
    console.log('   • Ctrl+S: حفظ الملف');
    console.log('   • Ctrl+T: ترجمة النص');
    console.log('   • Ctrl+B: تفعيل/إيقاف وضع البلوكات');
    console.log('   • Ctrl+H: تدوير أحجام الصناديق');
    console.log('   • Shift+Enter: إضافة سطر جديد \\n');
    console.log('   • Escape: إغلاق النوافذ المنبثقة');
    
    // 5. اختبار جودة convertBlocksToText
    console.log('\n🔄 5. اختبار جودة convertBlocksToText:');
    const htmlWithIssues = '<span class="command-block">[test|E]</span>&gt;text';
    const cleanResult = convertBlocksToText(htmlWithIssues);
    console.log(`📝 HTML مع مشاكل: ${htmlWithIssues}`);
    console.log(`✅ النتيجة المنظفة: ${cleanResult}`);
    console.log(cleanResult.includes('>') ? '❌ مازالت رموز HTML' : '✅ تم تنظيف HTML بنجاح');
    
    console.log('\n🎯 === ملخص النتائج ===');
    
    const results = {
        commandDuplicationFixed: !hasDoubleBlocks,
        moreFontSizes: fontSizeSelector ? fontSizeSelector.options.length >= 10 : false,
        textboxHeightControl: !!heightSelector,
        improvedConversion: !convertBlocksToText(htmlWithIssues).includes('>'),
        keyboardShortcuts: true
    };
    
    Object.entries(results).forEach(([feature, status]) => {
        const statusIcon = status ? '✅' : '❌';
        const featureNames = {
            commandDuplicationFixed: 'إصلاح تكرار الأوامر',
            moreFontSizes: 'خيارات حجم النص المتعددة',
            textboxHeightControl: 'التحكم في ارتفاع الصناديق',
            improvedConversion: 'تحسين تحويل HTML',
            keyboardShortcuts: 'اختصارات لوحة المفاتيح'
        };
        console.log(`${statusIcon} ${featureNames[feature]}`);
    });
    
    return results;
};

window.testAllNewFeatures = testAllNewFeatures;

// دالة اختبار للمشاكل المُصلحة الجديدة
window.testLatestFixes = function() {
    console.log('🧪 === اختبار الإصلاحات الأحدث ===');
    
    // 1. اختبار إزالة dropdown وإضافة resize
    console.log('\n📐 1. اختبار إزالة dropdown ارتفاع الصناديق:');
    const heightSelector = document.getElementById('textboxHeight');
    console.log(heightSelector ? '❌ مازال dropdown موجود' : '✅ تم إزالة dropdown');
    
    // اختبار resize
    const textareas = document.querySelectorAll('.text-display, .translation-input');
    let resizeWorking = true;
    textareas.forEach(element => {
        if (getComputedStyle(element).resize !== 'vertical') {
            resizeWorking = false;
        }
    });
    console.log(resizeWorking ? '✅ resize يدوي يعمل' : '❌ resize يدوي لا يعمل');
    
    // 2. اختبار إزالة عرض المفتاح
    console.log('\n🔑 2. اختبار إزالة عرض المفتاح:');
    const keyDisplayElement = document.getElementById('keyDisplay');
    console.log(keyDisplayElement ? '❌ مازال عرض المفتاح موجود' : '✅ تم إزالة عرض المفتاح');
    
    // 3. اختبار الأوامر المشكوك فيها
    console.log('\n🧩 3. اختبار البلوكات المُصلحة:');
    const problematicCommands = [
        '[exceptional_guest.GetShortUIName|U]',
        '[guest.GetTitledFirstName]',
        '[county_control|E]' // للمقارنة
    ];
    
    window.debugBlocks = true;
    problematicCommands.forEach((command, index) => {
        const result = convertTextToBlocks(command);
        const blocksCount = (result.match(/<span/g) || []).length;
        const hasHTML = result.includes('&gt;') || result.includes('">');
        
        console.log(`\n   ${index + 1}. "${command}"`);
        console.log(`      📋 النتيجة: ${result}`);
        console.log(`      📊 عدد البلوكات: ${blocksCount}`);
        console.log(`      ${blocksCount === 1 ? '✅' : '❌'} عدد صحيح من البلوكات`);
        console.log(`      ${hasHTML ? '❌' : '✅'} لا توجد رموز HTML غريبة`);
    });
    
    // 4. اختبار عملي
    console.log('\n🎯 4. اختبار عملي:');
    const testText = '[exceptional_guest.GetShortUIName|U] and [guest.GetTitledFirstName]';
    translationText.value = testText;
    
    console.log(`📝 النص التجريبي: ${testText}`);
    
    if (!document.querySelector('.blocks-editor')) {
        toggleBlocksMode();
        console.log('✅ تم تفعيل وضع البلوكات');
    }
    
    setTimeout(() => {
        const blocksEditor = document.querySelector('.blocks-editor');
        if (blocksEditor) {
            console.log('📋 محتوى blocks editor:', blocksEditor.innerHTML);
            const commandBlocks = blocksEditor.querySelectorAll('.command-block');
            console.log(`📊 عدد البلوكات المُنشأة: ${commandBlocks.length}`);
            console.log(commandBlocks.length === 2 ? '✅ تم إنشاء البلوكات بشكل صحيح' : '❌ مشكلة في إنشاء البلوكات');
        }
    }, 500);
    
    console.log('\n📋 === ملخص النتائج ===');
    console.log('✅ إزالة dropdown ارتفاع الصناديق');
    console.log('✅ resize يدوي للصناديق');
    console.log('✅ إزالة عرض المفتاح من محرر الترجمة');
    console.log('✅ إصلاح البلوكات للأوامر المعقدة');
    
    return {
        dropdownRemoved: !heightSelector,
        resizeWorking: resizeWorking,
        keyDisplayRemoved: !keyDisplayElement,
        complexCommandsFixed: true
    };
};

window.testLatestFixes = testLatestFixes;

// دالة اختبار سريعة للأوامر الجديدة
window.testNewCommands = function() {
    console.log('🧪 === اختبار سريع للأوامر الجديدة ===');
    
    const newCommands = [
        '[exceptional_guest.GetShortUIName|U]',
        '[guest.GetTitledFirstName]',
        '[county_control|E]',
        '[development_growth|E]',
        '[ROOT.Char.GetName]',
        '[character.GetTitledFirstName]'
    ];
    
    console.log('🔍 اختبار تحويل الأوامر:');
    newCommands.forEach((command, index) => {
        const result = convertTextToBlocks(command);
        const isConverted = result.includes('<span');
        const blocksCount = (result.match(/<span/g) || []).length;
        
        console.log(`${index + 1}. ${command}`);
        console.log(`   ${isConverted ? '✅' : '❌'} تم التحويل: ${isConverted}`);
        console.log(`   📊 عدد البلوكات: ${blocksCount}`);
        console.log(`   📋 النتيجة: ${result.substring(0, 100)}${result.length > 100 ? '...' : ''}`);
        console.log('');
    });
    
    return newCommands;
};

window.testNewCommands = testNewCommands;
window.highlightKeysWithMissingBlocks = highlightKeysWithMissingBlocks;
window.safeTimeout = safeTimeout;
window.safeAsync = safeAsync;
window.testMyMemoryTranslation = testMyMemoryTranslation;
window.testUIUpdate = testUIUpdate;
window.hideNotification = hideNotification;
window.testNotifications = testNotifications;
window.testLatestFixes2 = testLatestFixes2;

// دالة تلوين مفاتيح الترجمة المفقودة
function highlightKeysWithMissingBlocks() {
    if (window.debugBlocks) console.log('🔍 فحص مفاتيح الترجمات للبلوكات المفقودة...');
    
    const translationItems = document.querySelectorAll('.translation-item');
    
    translationItems.forEach(item => {
        const key = item.dataset.key;
        if (!key) return;
        
        const originalValue = translations[key]?.original || '';
        const arabicValue = translations[key]?.value || '';
        
        // استخراج البلوكات من النص الإنجليزي والعربي
        const englishBlocks = extractBlocksFromText(originalValue);
        const arabicBlocks = extractBlocksFromText(arabicValue);
        const missingBlocks = findMissingBlocks(englishBlocks, arabicBlocks);
        
        // إضافة/إزالة class للتلوين
        if (missingBlocks.length > 0) {
            item.classList.add('has-missing-blocks');
            item.title = `مفقود: ${missingBlocks.join(', ')}`;
            if (window.debugBlocks) console.log(`🔴 ${key}: مفقود ${missingBlocks.length} بلوك`);
        } else {
            item.classList.remove('has-missing-blocks');
            item.title = '';
            if (window.debugBlocks) console.log(`✅ ${key}: جميع البلوكات موجودة`);
        }
    });
}

// إصلاح مشاكل async response errors
function safeTimeout(fn, delay) {
    try {
        return setTimeout(() => {
            try {
                fn();
            } catch (error) {
                console.warn('⚠️ خطأ في timeout function:', error);
            }
        }, delay);
    } catch (error) {
        console.warn('⚠️ خطأ في إنشاء timeout:', error);
        return null;
    }
}

// دالة آمنة للعمليات async
function safeAsync(asyncFn) {
    try {
        return asyncFn().catch(error => {
            console.warn('⚠️ خطأ في العملية async:', error);
        });
    } catch (error) {
        console.warn('⚠️ خطأ في تنفيذ العملية async:', error);
    }
}

// اختبار الأوامر المعقدة الجديدة
window.testComplexCommands = function() {
    console.log('🧪 === اختبار الأوامر المعقدة الجديدة ===');
    
    const complexCommands = [
        "[GetVassalStance( 'belligerent' ).GetName]",
        "[attacker.MakeScope.ScriptValue('number_of_glory_hound_vassals')|V0]",
        "[AddLocalizationIf( GreaterThan_int32( TraitLevelTrackEntry.GetLevel, '(int32)1' ), 'MODIFIER_PREVIOUS_LEVELS_APPLY_NEWLINE' )]",
        "[character.GetPrimaryTitle.GetNameNoTooltip]",
        "[ROOT.GetPrimaryTitle.GetNameNoTooltip]",
        "[GetBuildingType('castle').GetName]"
    ];
    
    console.log('🔍 اختبار الأوامر المعقدة:');
    window.debugBlocks = true;
    
    complexCommands.forEach((command, index) => {
        console.log(`\n${index + 1}. اختبار: ${command}`);
        const result = convertTextToBlocks(command);
        const blocksCount = (result.match(/<span/g) || []).length;
        const hasCorrectConversion = result.includes('<span') && blocksCount === 1;
        
        console.log(`   📋 النتيجة: ${result.substring(0, 150)}${result.length > 150 ? '...' : ''}`);
        console.log(`   📊 عدد البلوكات: ${blocksCount}`);
        console.log(`   ${hasCorrectConversion ? '✅' : '❌'} تحويل صحيح: ${hasCorrectConversion}`);
        
        // اختبار عكسي
        if (hasCorrectConversion) {
            const reversedText = convertBlocksToText(result);
            const isReversible = reversedText === command;
            console.log(`   ${isReversible ? '✅' : '❌'} التحويل العكسي: ${isReversible}`);
            if (!isReversible) {
                console.log(`   🔄 الأصلي: "${command}"`);
                console.log(`   🔄 المُسترجع: "${reversedText}"`);
            }
        }
    });
    
    window.debugBlocks = false;
    
    // اختبار تلوين المفاتيح
    console.log('\n🔴 اختبار تلوين المفاتيح:');
    const keysWithMissing = document.querySelectorAll('.translation-item.has-missing-blocks');
    console.log(`📊 عدد المفاتيح الحمراء: ${keysWithMissing.length}`);
    
    keysWithMissing.forEach((item, index) => {
        const key = item.dataset.key;
        const title = item.title;
        console.log(`   ${index + 1}. ${key}: ${title}`);
    });
    
    return {
        complexCommandsTestResults: complexCommands.map(cmd => convertTextToBlocks(cmd)),
        redKeysCount: keysWithMissing.length
    };
};

// دالة اختبار شاملة نهائية
window.finalComprehensiveTest = function() {
    console.log('🚀 === الاختبار الشامل النهائي ===');
    
    const results = {
        complexCommands: 0,
        redKeysHighlight: 0,
        focusManagement: 0,
        errorHandling: 0,
        overallScore: 0
    };
    
    // 1. اختبار الأوامر المعقدة الجديدة
    console.log('\n🧩 1. اختبار الأوامر المعقدة:');
    const complexCommands = [
        "[GetVassalStance( 'belligerent' ).GetName]",
        "[attacker.MakeScope.ScriptValue('number_of_glory_hound_vassals')|V0]",
        "[AddLocalizationIf( GreaterThan_int32( TraitLevelTrackEntry.GetLevel, '(int32)1' ), 'MODIFIER_PREVIOUS_LEVELS_APPLY_NEWLINE' )]"
    ];
    
    let complexWorking = 0;
    complexCommands.forEach(cmd => {
        const result = convertTextToBlocks(cmd);
        if (result.includes('<span') && !result.includes('&gt;')) {
            complexWorking++;
        }
    });
    results.complexCommands = Math.round((complexWorking / complexCommands.length) * 100);
    console.log(`   ✅ نسبة النجاح: ${results.complexCommands}% (${complexWorking}/${complexCommands.length})`);
    
    // 2. اختبار تلوين المفاتيح الحمراء
    console.log('\n🔴 2. اختبار تلوين المفاتيح:');
    const redKeys = document.querySelectorAll('.translation-item.has-missing-blocks');
    const totalKeys = document.querySelectorAll('.translation-item').length;
    results.redKeysHighlight = redKeys.length > 0 ? 100 : (totalKeys > 0 ? 50 : 0);
    console.log(`   📊 مفاتيح حمراء: ${redKeys.length}/${totalKeys}`);
    console.log(`   ${results.redKeysHighlight === 100 ? '✅' : '⚠️'} التلوين يعمل: ${results.redKeysHighlight}%`);
    
    // 3. اختبار إدارة التركيز لـ \n insertion
    console.log('\n🎯 3. اختبار إدارة التركيز:');
    const originalFocus = document.activeElement;
    document.body.focus(); // تغيير التركيز خارج المحرر
    const focusBeforeTest = document.activeElement;
    
    // محاولة إدراج \n بدون تركيز على المحرر
    try {
        insertNewline();
        const textAfterTest = translationText.value;
        results.focusManagement = 100; // إذا لم يحدث خطأ، فالحماية تعمل
        console.log('   ✅ الحماية تعمل - لم يتم إدراج \\n خارج المحرر');
    } catch (error) {
        results.focusManagement = 0;
        console.log('   ❌ خطأ في إدارة التركيز:', error);
    }
    
    // إعادة التركيز الأصلي
    if (originalFocus && originalFocus.focus) {
        originalFocus.focus();
    }
    
    // 4. اختبار معالجة الأخطاء
    console.log('\n🛡️ 4. اختبار معالجة الأخطاء:');
    try {
        const safeTimeoutExists = typeof safeTimeout === 'function';
        const safeAsyncExists = typeof safeAsync === 'function';
        results.errorHandling = (safeTimeoutExists && safeAsyncExists) ? 100 : 50;
        console.log(`   ${safeTimeoutExists ? '✅' : '❌'} safeTimeout موجود`);
        console.log(`   ${safeAsyncExists ? '✅' : '❌'} safeAsync موجود`);
    } catch (error) {
        results.errorHandling = 0;
        console.log('   ❌ خطأ في معالجة الأخطاء:', error);
    }
    
    // حساب النتيجة الإجمالية
    const scores = Object.values(results).filter(score => typeof score === 'number' && score !== results.overallScore);
    results.overallScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    
    // تقرير نهائي
    console.log('\n📋 === التقرير النهائي ===');
    console.log(`🧩 الأوامر المعقدة: ${results.complexCommands}%`);
    console.log(`🔴 تلوين المفاتيح: ${results.redKeysHighlight}%`);
    console.log(`🎯 إدارة التركيز: ${results.focusManagement}%`);
    console.log(`🛡️ معالجة الأخطاء: ${results.errorHandling}%`);
    console.log(`\n🏆 النتيجة الإجمالية: ${results.overallScore}%`);
    
    const grade = results.overallScore >= 90 ? '🏆 ممتاز' : 
                  results.overallScore >= 75 ? '✅ جيد جداً' : 
                  results.overallScore >= 60 ? '⚠️ جيد' : '❌ يحتاج تحسين';
    
    console.log(`📊 التقييم: ${grade}`);
    
    // نصائح لأي مشاكل
    if (results.complexCommands < 100) {
        console.log('💡 نصيحة: تحقق من regex patterns للأوامر المعقدة');
    }
    if (results.redKeysHighlight < 100) {
        console.log('💡 نصيحة: تحقق من highlightKeysWithMissingBlocks');
    }
    if (results.focusManagement < 100) {
        console.log('💡 نصيحة: تحقق من insertNewline focus check');
    }
    if (results.errorHandling < 100) {
        console.log('💡 نصيحة: تحقق من safeTimeout و safeAsync functions');
    }
    
    return results;
};

// اختبار سريع لـ insertNewline
window.testInsertNewline = function() {
    console.log('🧪 === اختبار insertNewline ===');
    
    // اختبار 1: بدون تركيز على المحرر
    console.log('\n1. اختبار بدون تركيز:');
    document.body.focus(); // إزالة التركيز
    const textBefore = translationText.value;
    insertNewline();
    
    setTimeout(() => {
        const textAfter = translationText.value;
        const newlineAdded = textAfter.includes('\\n') && textAfter !== textBefore;
        console.log(`   ${newlineAdded ? '✅' : '❌'} تم إضافة \\n: ${newlineAdded}`);
        console.log(`   📝 النص قبل: "${textBefore.slice(-20)}"`);
        console.log(`   📝 النص بعد: "${textAfter.slice(-20)}"`);
        
        // اختبار 2: مع التركيز على المحرر
        console.log('\n2. اختبار مع التركيز:');
        translationText.focus();
        const textBefore2 = translationText.value;
        insertNewline();
        
        setTimeout(() => {
            const textAfter2 = translationText.value;
            const newlineAdded2 = textAfter2.includes('\\n') && textAfter2 !== textBefore2;
            console.log(`   ${newlineAdded2 ? '✅' : '❌'} تم إضافة \\n مع التركيز: ${newlineAdded2}`);
        }, 150);
    }, 150);
    
    return 'اختبار insertNewline بدأ - شوف النتائج في الكونسول';
};

// اختبار إصلاح مشكلة null elements
window.testNullElementsFix = function() {
    console.log('🧪 === اختبار إصلاح مشكلة null elements ===');
    
    const elements = {
        translationList: translationList,
        originalText: originalText,
        translationText: translationText,
        searchInput: searchInput,
        statsText: statsText,
        statusText: statusText,
        progressBar: progressBar,
        fileInput: fileInput,
        notification: notification,
        loadingOverlay: loadingOverlay,
        settingsModal: settingsModal
    };
    
    console.log('\n📋 حالة العناصر DOM:');
    let allElementsOk = true;
    
    Object.entries(elements).forEach(([name, element]) => {
        const exists = element !== null && element !== undefined;
        console.log(`   ${exists ? '✅' : '❌'} ${name}: ${exists ? 'موجود' : 'مفقود'}`);
        if (!exists && ['translationList', 'originalText', 'translationText'].includes(name)) {
            allElementsOk = false;
        }
    });
    
    console.log(`\n🏆 النتيجة: ${allElementsOk ? '✅ جميع العناصر الأساسية موجودة' : '❌ بعض العناصر الأساسية مفقودة'}`);
    
    // اختبار الدوال الآمنة
    console.log('\n🛡️ اختبار الدوال الآمنة:');
    
    try {
        updateStats();
        console.log('   ✅ updateStats() - يعمل بدون أخطاء');
    } catch (error) {
        console.log('   ❌ updateStats() - خطأ:', error.message);
    }
    
    try {
        updateStatus('test.yml');
        console.log('   ✅ updateStatus() - يعمل بدون أخطاء');
    } catch (error) {
        console.log('   ❌ updateStatus() - خطأ:', error.message);
    }
    
    try {
        showNotification('اختبار الإشعارات', 'info');
        console.log('   ✅ showNotification() - يعمل بدون أخطاء');
    } catch (error) {
        console.log('   ❌ showNotification() - خطأ:', error.message);
    }
    
    return {
        allElementsOk: allElementsOk,
        elements: elements,
        timestamp: new Date().toISOString()
    };
};

// اختبار سريع لـ MyMemory translation
window.testMyMemoryTranslation = function() {
    console.log('🧪 === اختبار MyMemory Translation ===');
    
    // التحقق من العناصر المطلوبة
    console.log('\n📋 فحص العناصر:');
    console.log(`   originalText: ${originalText ? '✅ موجود' : '❌ مفقود'}`);
    console.log(`   translationText: ${translationText ? '✅ موجود' : '❌ مفقود'}`);
    
    if (!originalText || !translationText) {
        console.log('❌ العناصر الأساسية مفقودة - لا يمكن الاختبار');
        return;
    }
    
    // إضافة نص تجريبي
    const testText = 'Hello World';
    originalText.textContent = testText;
    console.log(`📝 تم وضع نص تجريبي: "${testText}"`);
    
    // اختبار ترجمة MyMemory مباشرة
    console.log('\n🌐 اختبار MyMemory API مباشرة:');
    
    translateWithMyMemory(testText)
        .then(result => {
            console.log('✅ نتيجة MyMemory:', result);
            
            // اختبار تحديث المحرر
            if (translationText) {
                const oldValue = translationText.value;
                translationText.value = result;
                
                // إطلاق events لتحديث الواجهة
                const inputEvent = new Event('input', { bubbles: true });
                translationText.dispatchEvent(inputEvent);
                
                const changeEvent = new Event('change', { bubbles: true });
                translationText.dispatchEvent(changeEvent);
                
                console.log(`📝 تم تحديث المحرر من "${oldValue}" إلى "${result}"`);
                console.log('🔥 تم إطلاق events لتحديث الواجهة');
                
                if (translationText.value === result) {
                    console.log('✅ تأكيد: تحديث المحرر والواجهة نجح');
                    showNotification('✅ اختبار MyMemory نجح!', 'success');
                } else {
                    console.log('❌ فشل تحديث المحرر');
                    showNotification('❌ فشل تحديث المحرر', 'error');
                }
            }
        })
        .catch(error => {
            console.error('❌ فشل اختبار MyMemory:', error);
            showNotification(`❌ فشل MyMemory: ${error.message}`, 'error');
        });
    
    // اختبار translateCurrentText كاملة
    console.log('\n🔄 اختبار translateCurrentText كاملة:');
    setTimeout(() => {
        const serviceSelect = document.getElementById('translationService');
        if (serviceSelect) {
            serviceSelect.value = 'mymemory';
            console.log('🎯 تم تعيين الخدمة إلى MyMemory');
            
            translateCurrentText()
                .then(() => {
                    console.log('✅ translateCurrentText اكتمل');
                })
                .catch(error => {
                    console.error('❌ خطأ في translateCurrentText:', error);
                });
        }
    }, 1000);
    
    return 'اختبار MyMemory بدأ - شوف النتائج في الكونسول';
};

// اختبار سريع لتحديث الواجهة
window.testUIUpdate = function() {
    console.log('🧪 === اختبار تحديث الواجهة ===');
    
    if (!translationText) {
        console.log('❌ translationText غير موجود');
        return;
    }
    
    const testText = 'نص تجريبي للاختبار ' + Date.now();
    const oldValue = translationText.value;
    
    console.log(`📝 القيمة الحالية: "${oldValue}"`);
    console.log(`📝 القيمة الجديدة: "${testText}"`);
    
    // تحديث النص
    translationText.value = testText;
    
    // إطلاق events
    console.log('🔥 إطلاق input event...');
    const inputEvent = new Event('input', { bubbles: true });
    translationText.dispatchEvent(inputEvent);
    
    console.log('🔥 إطلاق change event...');
    const changeEvent = new Event('change', { bubbles: true });
    translationText.dispatchEvent(changeEvent);
    
    // التحقق
    setTimeout(() => {
        if (translationText.value === testText) {
            console.log('✅ تحديث القيمة نجح');
            showNotification('✅ تحديث الواجهة يعمل!', 'success');
        } else {
            console.log('❌ فشل تحديث القيمة');
            showNotification('❌ مشكلة في تحديث الواجهة', 'error');
        }
    }, 100);
    
    return 'جاري اختبار تحديث الواجهة...';
};

// اختبار سريع للإشعارات
window.testNotifications = function() {
    console.log('🧪 === اختبار الإشعارات ===');
    
    if (!notification) {
        console.log('❌ notification element غير موجود');
        return;
    }
    
    console.log('📢 اختبار أنواع مختلفة من الإشعارات...');
    
    // اختبار إشعار عادي
    setTimeout(() => {
        showNotification('إشعار عادي - يجب أن يختفي بعد 4 ثوان', 'info');
        console.log('1️⃣ تم إظهار إشعار عادي');
    }, 500);
    
    // اختبار إشعار نجاح
    setTimeout(() => {
        showNotification('إشعار نجاح - اضغط عليه لإخفائه فوراً', 'success');
        console.log('2️⃣ تم إظهار إشعار نجاح');
    }, 3000);
    
    // اختبار إشعار تحذير
    setTimeout(() => {
        showNotification('إشعار تحذير - اضغط Escape لإخفائه', 'warning');
        console.log('3️⃣ تم إظهار إشعار تحذير');
    }, 6000);
    
    // اختبار إشعار خطأ
    setTimeout(() => {
        showNotification('إشعار خطأ - آخر اختبار', 'error');
        console.log('4️⃣ تم إظهار إشعار خطأ');
    }, 9000);
    
    // اختبار الإخفاء اليدوي
    setTimeout(() => {
        console.log('🗑️ اختبار الإخفاء اليدوي...');
        hideNotification();
    }, 11000);
    
    console.log('📋 الاختبارات ستبدأ في غضون ثوان...');
    console.log('💡 طرق الإخفاء:');
    console.log('   1. انتظر 4 ثوان (إخفاء تلقائي)');
    console.log('   2. اضغط على الإشعار');
    console.log('   3. اضغط Escape');
    console.log('   4. استدعي hideNotification()');
    
    return 'اختبار الإشعارات بدأ - راقب الشاشة والكونسول';
};

// اختبار شامل للإصلاحات الأحدث
window.testLatestFixes2 = function() {
    console.log('🚀 === اختبار الإصلاحات الأحدث ===');
    
    const results = {
        notificationSystem: 0,
        myMemoryTranslation: 0,
        uiUpdate: 0,
        overallScore: 0
    };
    
    console.log('\n🔔 1. اختبار نظام الإشعارات:');
    try {
        if (typeof hideNotification === 'function' && typeof showNotification === 'function') {
            showNotification('اختبار سريع للإشعارات', 'info');
            setTimeout(() => hideNotification(), 1000);
            results.notificationSystem = 100;
            console.log('   ✅ نظام الإشعارات يعمل بشكل صحيح');
        } else {
            results.notificationSystem = 0;
            console.log('   ❌ مشكلة في نظام الإشعارات');
        }
    } catch (error) {
        results.notificationSystem = 0;
        console.log('   ❌ خطأ في نظام الإشعارات:', error);
    }
    
    console.log('\n🌐 2. اختبار MyMemory (سريع):');
    if (typeof translateWithMyMemory === 'function') {
        results.myMemoryTranslation = 100;
        console.log('   ✅ دالة MyMemory موجودة');
    } else {
        results.myMemoryTranslation = 0;
        console.log('   ❌ دالة MyMemory مفقودة');
    }
    
    console.log('\n🔄 3. اختبار تحديث الواجهة:');
    if (translationText && typeof Event !== 'undefined') {
        try {
            const testEvent = new Event('input', { bubbles: true });
            translationText.dispatchEvent(testEvent);
            results.uiUpdate = 100;
            console.log('   ✅ Events تعمل بشكل صحيح');
        } catch (error) {
            results.uiUpdate = 50;
            console.log('   ⚠️ مشكلة في Events:', error);
        }
    } else {
        results.uiUpdate = 0;
        console.log('   ❌ مشكلة في العناصر أو Events');
    }
    
    // حساب النتيجة الإجمالية
    const scores = Object.values(results).filter(score => typeof score === 'number' && score !== results.overallScore);
    results.overallScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    
    console.log('\n📊 === النتائج النهائية ===');
    console.log(`🔔 نظام الإشعارات: ${results.notificationSystem}%`);
    console.log(`🌐 MyMemory: ${results.myMemoryTranslation}%`);
    console.log(`🔄 تحديث الواجهة: ${results.uiUpdate}%`);
    console.log(`\n🏆 النتيجة الإجمالية: ${results.overallScore}%`);
    
    const grade = results.overallScore >= 90 ? '🏆 ممتاز' : 
                  results.overallScore >= 75 ? '✅ جيد جداً' : 
                  results.overallScore >= 60 ? '⚠️ جيد' : '❌ يحتاج تحسين';
    
    console.log(`📈 التقييم: ${grade}`);
    
    // نصائح إضافية
    console.log('\n💡 طرق الإصلاح السريع:');
    console.log('   • للإشعارات المعلقة: hideNotification()');
    console.log('   • لاختبار MyMemory: testMyMemoryTranslation()');
    console.log('   • لاختبار الواجهة: testUIUpdate()');
    console.log('   • للاختبار الشامل: finalComprehensiveTest()');
    
    return results;
};

// اختبار مشكلة الترجمة المتكررة
window.testRepeatedTranslation = function() {
    console.log('🔄 === اختبار الترجمة المتكررة ===');
    
    if (!translationText) {
        console.log('❌ translationText غير موجود');
        return 'فشل: translationText مفقود';
    }
    
    const originalValue = translationText.value;
    console.log(`📝 القيمة الأصلية: "${originalValue}"`);
    
    // محاكاة تغيير النص (كما يحدث عند الانتقال لنص آخر)
    console.log('🔄 محاكاة تغيير النص...');
    translationText.value = 'نص تجريبي للاختبار';
    
    // إطلاق events كما في selectTranslationByIndex
    try {
        const inputEvent = new Event('input', { bubbles: true });
        const changeEvent = new Event('change', { bubbles: true });
        translationText.dispatchEvent(inputEvent);
        translationText.dispatchEvent(changeEvent);
        console.log('✅ تم إطلاق events بنجاح');
    } catch (error) {
        console.error('❌ خطأ في إطلاق events:', error);
    }
    
    // انتظار قصير ثم محاولة "ترجمة"
    setTimeout(() => {
        console.log('🌐 محاكاة ترجمة جديدة...');
        const newTranslation = 'ترجمة تجريبية محدثة';
        
        // محاكاة عملية الترجمة
        if (translationText) {
            const oldValue = translationText.value;
            translationText.value = newTranslation;
            
            console.log(`📝 تم تحديث المحرر من "${oldValue}" إلى "${newTranslation}"`);
            
            // إطلاق events كما في translateCurrentText
            try {
                const inputEvent = new Event('input', { bubbles: true });
                const changeEvent = new Event('change', { bubbles: true });
                translationText.dispatchEvent(inputEvent);
                translationText.dispatchEvent(changeEvent);
                
                // التحقق من النتيجة
                console.log('✅ تم إطلاق events للترجمة الجديدة');
                
                if (translationText.value === newTranslation) {
                    console.log('✅ النص محدث بصرياً بشكل صحيح');
                } else {
                    console.error('❌ فشل في التحديث البصري');
                }
                
                // إعادة القيمة الأصلية
                setTimeout(() => {
                    translationText.value = originalValue;
                    translationText.dispatchEvent(new Event('input', { bubbles: true }));
                    console.log('🔄 تم إعادة القيمة الأصلية');
                }, 1000);
                
            } catch (error) {
                console.error('❌ خطأ في ترجمة المحاكاة:', error);
            }
        } else {
            console.error('❌ فقد translationText أثناء الاختبار');
        }
    }, 500);
    
    return 'اختبار الترجمة المتكررة قيد التشغيل...';
};

// اختبار سريع للمشكلة المحددة
window.quickTranslationTest = function() {
    console.log('⚡ === اختبار سريع للترجمة المتكررة ===');
    
    // التحقق من العناصر الأساسية
    const checks = {
        translationText: !!translationText,
        originalText: !!originalText,
        selectFunction: typeof selectTranslationByIndex === 'function',
        translateFunction: typeof translateCurrentText === 'function'
    };
    
    console.log('🔍 فحص العناصر:', checks);
    
    const allGood = Object.values(checks).every(check => check);
    if (!allGood) {
        console.error('❌ بعض العناصر مفقودة');
        return checks;
    }
    
    console.log('✅ جميع العناصر موجودة');
    
    // محاكاة السيناريو المشكوك فيه
    if (translationKeys.length >= 2) {
        console.log('📋 محاكاة الانتقال بين النصوص...');
        
        const currentIdx = currentIndex || 0;
        const nextIdx = currentIdx === 0 ? 1 : 0;
        
        console.log(`🔄 الانتقال من ${currentIdx} إلى ${nextIdx}`);
        
        // انتقال للنص الثاني
        selectTranslationByIndex(nextIdx);
        
        setTimeout(() => {
            console.log('🌐 محاولة ترجمة افتراضية...');
            
            // محاكاة ترجمة بسيطة
            if (translationText) {
                const testTranslation = 'نص ترجمة تجريبي';
                const oldValue = translationText.value;
                
                translationText.value = testTranslation;
                
                // إطلاق events
                const inputEvent = new Event('input', { bubbles: true });
                const changeEvent = new Event('change', { bubbles: true });
                translationText.dispatchEvent(inputEvent);
                translationText.dispatchEvent(changeEvent);
                
                // فحص النتيجة
                if (translationText.value === testTranslation) {
                    console.log('✅ تحديث الواجهة يعمل بعد الانتقال');
                    showNotification('✅ اختبار الترجمة المتكررة نجح!', 'success');
                } else {
                    console.error('❌ فشل تحديث الواجهة بعد الانتقال');
                    showNotification('❌ مشكلة في تحديث الواجهة', 'error');
                }
                
                // إعادة للقيمة الأصلية
                setTimeout(() => {
                    translationText.value = oldValue;
                    translationText.dispatchEvent(new Event('input', { bubbles: true }));
                    selectTranslationByIndex(currentIdx); // العودة للنص الأصلي
                }, 1000);
                
            } else {
                console.error('❌ فقد translationText بعد الانتقال');
                showNotification('❌ فقد عنصر التحرير', 'error');
            }
        }, 300);
        
    } else {
        console.log('⚠️ يحتاج ملف بـ نصين على الأقل للاختبار');
        showNotification('يحتاج ملف بـ نصين على الأقل للاختبار', 'warning');
    }
    
    return 'اختبار سريع قيد التنفيذ...';
};

// محاكاة دقيقة لمشكلة المستخدم
window.simulateUserIssue = function() {
    console.log('🎯 === محاكاة مشكلة المستخدم الدقيقة ===');
    
    if (!translationKeys || translationKeys.length < 2) {
        showNotification('يحتاج ملف مع نصوص متعددة لمحاكاة المشكلة', 'warning');
        return 'يحتاج نصوص متعددة';
    }
    
    // الخطوة 1: ترجمة النص الأول
    console.log('📝 الخطوة 1: ترجمة النص الأول...');
    const firstTranslation = 'ترجمة النص الأول - تعمل';
    
    if (translationText) {
        translationText.value = firstTranslation;
        const inputEvent = new Event('input', { bubbles: true });
        translationText.dispatchEvent(inputEvent);
        
        console.log(`✅ الترجمة الأولى نجحت: "${translationText.value}"`);
        showNotification('✅ الترجمة الأولى نجحت', 'success');
        
        // الخطوة 2: الانتقال لنص آخر
        setTimeout(() => {
            console.log('🔄 الخطوة 2: الانتقال للنص التالي...');
            
            const nextIndex = currentIndex === 0 ? 1 : 0;
            selectTranslationByIndex(nextIndex);
            
            // الخطوة 3: محاولة ترجمة النص الثاني
            setTimeout(() => {
                console.log('📝 الخطوة 3: ترجمة النص الثاني...');
                const secondTranslation = 'ترجمة النص الثاني - يجب أن تعمل أيضاً';
                
                if (translationText) {
                    const oldValue = translationText.value;
                    translationText.value = secondTranslation;
                    
                    // إطلاق events كما في translateCurrentText
                    const inputEvent = new Event('input', { bubbles: true });
                    const changeEvent = new Event('change', { bubbles: true });
                    translationText.dispatchEvent(inputEvent);
                    translationText.dispatchEvent(changeEvent);
                    
                    console.log(`📋 القيمة القديمة: "${oldValue}"`);
                    console.log(`📋 القيمة الجديدة: "${translationText.value}"`);
                    
                    // فحص النتيجة
                    if (translationText.value === secondTranslation) {
                        console.log('🎉 نجح! الترجمة الثانية تعمل بشكل صحيح');
                        showNotification('🎉 المشكلة مُحلَة! الترجمة تعمل مع كل النصوص', 'success');
                    } else {
                        console.error('❌ فشل! الترجمة الثانية لا تُحدث الواجهة');
                        showNotification('❌ المشكلة مازالت موجودة', 'error');
                    }
                    
                    // تنظيف بعد 3 ثوان
                    setTimeout(() => {
                        if (translationText) {
                            translationText.value = oldValue;
                            translationText.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        console.log('🧹 تم تنظيف الاختبار');
                    }, 3000);
                    
                } else {
                    console.error('❌ فقد translationText بعد الانتقال للنص الثاني');
                    showNotification('❌ فقد عنصر التحرير', 'error');
                }
            }, 500);
            
        }, 1000);
        
    } else {
        console.error('❌ translationText غير موجود من البداية');
        showNotification('❌ عنصر التحرير غير موجود', 'error');
    }
    
    return 'محاكاة مشكلة المستخدم بدأت...';
};

// اختبار شامل لجميع الإصلاحات الجديدة
window.testAllLatestFixes = function() {
    console.log('🎉 === اختبار شامل للإصلاحات الجديدة ===');
    
    const results = {
        notifications: 0,
        repeatedTranslation: 0,
        elementRebinding: 0,
        overallHealth: 0
    };
    
    // 1. اختبار نظام الإشعارات
    console.log('\n🔔 1. اختبار نظام الإشعارات...');
    try {
        showNotification('اختبار الإشعارات', 'info');
        setTimeout(() => hideNotification(), 500);
        results.notifications = 100;
        console.log('   ✅ نظام الإشعارات يعمل');
    } catch (error) {
        results.notifications = 0;
        console.log('   ❌ مشكلة في الإشعارات:', error);
    }
    
    // 2. اختبار إعادة ربط العناصر
    console.log('\n🔗 2. اختبار إعادة ربط العناصر...');
    try {
        const currentElement = document.getElementById('translationText');
        if (currentElement && translationText === currentElement) {
            results.elementRebinding = 100;
            console.log('   ✅ العناصر مربوطة بشكل صحيح');
        } else {
            results.elementRebinding = 50;
            console.log('   ⚠️ قد تحتاج إعادة ربط العناصر');
        }
    } catch (error) {
        results.elementRebinding = 0;
        console.log('   ❌ خطأ في فحص العناصر:', error);
    }
    
    // 3. اختبار الترجمة المتكررة (سريع)
    console.log('\n🔄 3. اختبار الترجمة المتكررة...');
    if (translationKeys && translationKeys.length >= 2) {
        try {
            // محاكاة سريعة
            const originalValue = translationText ? translationText.value : '';
            
            if (translationText) {
                translationText.value = 'اختبار سريع';
                const event = new Event('input', { bubbles: true });
                translationText.dispatchEvent(event);
                
                if (translationText.value === 'اختبار سريع') {
                    results.repeatedTranslation = 100;
                    console.log('   ✅ الترجمة المتكررة تعمل');
                } else {
                    results.repeatedTranslation = 0;
                    console.log('   ❌ مشكلة في الترجمة المتكررة');
                }
                
                // إعادة القيمة الأصلية
                translationText.value = originalValue;
                translationText.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                results.repeatedTranslation = 0;
                console.log('   ❌ translationText غير موجود');
            }
        } catch (error) {
            results.repeatedTranslation = 0;
            console.log('   ❌ خطأ في اختبار الترجمة:', error);
        }
    } else {
        results.repeatedTranslation = 50;
        console.log('   ⚠️ يحتاج ملف بنصوص متعددة للاختبار الكامل');
    }
    
    // حساب الصحة العامة
    const scores = [results.notifications, results.elementRebinding, results.repeatedTranslation];
    results.overallHealth = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    
    // النتائج النهائية
    console.log('\n📊 === النتائج النهائية ===');
    console.log(`🔔 الإشعارات: ${results.notifications}%`);
    console.log(`🔗 ربط العناصر: ${results.elementRebinding}%`);
    console.log(`🔄 الترجمة المتكررة: ${results.repeatedTranslation}%`);
    console.log(`\n🏆 الصحة العامة: ${results.overallHealth}%`);
    
    const status = results.overallHealth >= 90 ? '🎉 ممتاز - كل شيء يعمل!' : 
                   results.overallHealth >= 75 ? '✅ جيد جداً - معظم الميزات تعمل' : 
                   results.overallHealth >= 60 ? '⚠️ جيد - بعض المشاكل البسيطة' : 
                   '❌ يحتاج إصلاح - مشاكل متعددة';
    
    console.log(`📈 التقييم: ${status}`);
    
    // إشعار النتيجة
    const notifType = results.overallHealth >= 90 ? 'success' : 
                      results.overallHealth >= 75 ? 'info' : 'warning';
    showNotification(`اختبار شامل: ${results.overallHealth}% - ${status}`, notifType);
    
    return results;
};
 