/**
 * Uzei - Literature Review Extension
 * Copyright Checker Module
 * 
 * Implements copyright verification using:
 * 1. Domain whitelist/blacklist from academic_dblist.json
 * 2. Unpaywall API for OA status checking
 * 3. DOI-based verification
 * 4. Caching for performance
 */

const COPYRIGHT_CONFIG = {
  UNPAYWALL_API: 'https://api.unpaywall.org/v2',
  UNPAYWALL_EMAIL: 'wangzifeng157@gmail.com',
  CACHE_DURATION: 30 * 24 * 60 * 60 * 1000, // 30 days
  API_TIMEOUT: 10000, // 10 seconds
};

// Academic database lists (will be loaded from academic_dblist.json)
let academicDatabases = {
  whitelist: [],
  blacklist: [],
  conditional: []
};

/**
 * Load academic database lists from JSON file
 */
async function loadAcademicDatabases() {
  try {
    const response = await fetch(chrome.runtime.getURL('academic_dblist.json'));
    const data = await response.json();
    
    // Flatten whitelist domains
    academicDatabases.whitelist = [
      ...data.allowlist.preprint_servers,
      ...data.allowlist.open_access_publishers,
      ...data.allowlist.open_access_repositories,
      ...data.allowlist.institutional_repositories
    ];
    
    // Flatten blacklist domains
    academicDatabases.blacklist = [];
    for (const category of Object.values(data.blacklist)) {
      if (Array.isArray(category)) {
        academicDatabases.blacklist.push(...category);
      } else if (typeof category === 'object') {
        for (const subcategory of Object.values(category)) {
          if (Array.isArray(subcategory)) {
            academicDatabases.blacklist.push(...subcategory);
          }
        }
      }
    }
    
    // Load conditional domains
    academicDatabases.conditional = data.conditional?.mixed_content || [];
    
    console.log('Academic databases loaded:', {
      whitelist: academicDatabases.whitelist.length,
      blacklist: academicDatabases.blacklist.length,
      conditional: academicDatabases.conditional.length
    });
    
    return true;
  } catch (error) {
    console.error('Error loading academic databases:', error);
    return false;
  }
}

/**
 * Check if domain is in whitelist
 */
function isWhitelisted(domain) {
  if (!domain) return false;
  const lowerDomain = domain.toLowerCase();
  return academicDatabases.whitelist.some(whitelisted => 
    lowerDomain.includes(whitelisted.toLowerCase())
  );
}

/**
 * Check if domain is in blacklist
 */
function isBlacklisted(domain) {
  if (!domain) return false;
  const lowerDomain = domain.toLowerCase();
  return academicDatabases.blacklist.some(blacklisted => 
    lowerDomain.includes(blacklisted.toLowerCase())
  );
}

/**
 * Check if domain is conditional (mixed OA/paywalled content)
 */
function isConditional(domain) {
  if (!domain) return false;
  const lowerDomain = domain.toLowerCase();
  return academicDatabases.conditional.some(conditional => 
    lowerDomain.includes(conditional.toLowerCase())
  );
}

/**
 * Extract DOI from PDF URL
 */
function extractDOIFromPDFUrl(url) {
  if (!url) return null;
  
  try {
    // Pattern 1: DOI in path (e.g., /10.1234/article.pdf)
    const doiInPath = url.match(/\/([10]\.\d{4,}\/[^\s]+?)\.pdf/i);
    if (doiInPath) {
      return doiInPath[1];
    }
    
    // Pattern 2: Springer/Nature style (e.g., /content/pdf/10.1007/s12345-020-00123-4.pdf)
    const springerMatch = url.match(/(10\.\d{4,}\/[^\s\/]+)/);
    if (springerMatch) {
      return springerMatch[1];
    }
    
    // Pattern 3: ArXiv papers (use arXiv ID, can be converted to DOI)
    const arxivMatch = url.match(/arxiv\.org\/pdf\/(\d+\.\d+)/i);
    if (arxivMatch) {
      // ArXiv IDs can be converted to DOIs: 10.48550/arXiv.XXXX.XXXXX
      return `10.48550/arXiv.${arxivMatch[1]}`;
    }
    
    // Pattern 4: DOI in query parameter (e.g., ?doi=10.1234/article)
    const urlObj = new URL(url);
    const doiParam = urlObj.searchParams.get('doi');
    if (doiParam) {
      return doiParam;
    }
    
    // Pattern 5: IEEE style (arnumber parameter can sometimes map to DOI)
    // Note: This is less reliable, might need additional lookup
    
    return null;
  } catch (error) {
    console.warn('Error extracting DOI from PDF URL:', error);
    return null;
  }
}

/**
 * Get cached OA status for a DOI
 */
async function getCachedOAStatus(doi) {
  if (!doi) return null;
  
  try {
    const cacheKey = `oa_cache_${doi}`;
    const result = await chrome.storage.local.get(cacheKey);
    
    if (result[cacheKey]) {
      const cached = result[cacheKey];
      const age = Date.now() - cached.timestamp;
      
      // Check if cache is still valid
      if (age < COPYRIGHT_CONFIG.CACHE_DURATION) {
        console.log(`Using cached OA status for ${doi}`);
        return cached.data;
      } else {
        // Cache expired, remove it
        await chrome.storage.local.remove(cacheKey);
      }
    }
    
    return null;
  } catch (error) {
    console.warn('Error getting cached OA status:', error);
    return null;
  }
}

/**
 * Cache OA status for a DOI
 */
async function cacheOAStatus(doi, oaData) {
  if (!doi || !oaData) return;
  
  try {
    const cacheKey = `oa_cache_${doi}`;
    await chrome.storage.local.set({
      [cacheKey]: {
        data: oaData,
        timestamp: Date.now()
      }
    });
    console.log(`Cached OA status for ${doi}`);
  } catch (error) {
    console.warn('Error caching OA status:', error);
  }
}

/**
 * Query Unpaywall API for OA status
 */
async function queryUnpaywall(doi) {
  if (!doi) {
    return { is_oa: false, error: 'No DOI provided' };
  }
  
  // Check cache first
  const cached = await getCachedOAStatus(doi);
  if (cached) {
    return cached;
  }
  
  try {
    // Clean DOI (remove any prefix like "doi:" or "DOI:")
    const cleanDOI = doi.replace(/^doi:\s*/i, '').trim();
    
    // Encode DOI for URL
    const encodedDOI = encodeURIComponent(cleanDOI);
    const url = `${COPYRIGHT_CONFIG.UNPAYWALL_API}/${encodedDOI}?email=${COPYRIGHT_CONFIG.UNPAYWALL_EMAIL}`;
    
    console.log(`Querying Unpaywall for DOI: ${cleanDOI}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), COPYRIGHT_CONFIG.API_TIMEOUT);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 404) {
        // DOI not found in Unpaywall - treat as not OA
        const result = { is_oa: false, oa_status: 'not_found', doi: cleanDOI };
        await cacheOAStatus(cleanDOI, result);
        return result;
      }
      throw new Error(`Unpaywall API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract relevant OA information
    const oaData = {
      doi: data.doi,
      is_oa: data.is_oa || false,
      oa_status: data.oa_status, // 'gold', 'green', 'hybrid', 'bronze', 'closed'
      oa_url: data.best_oa_location?.url,
      host_type: data.best_oa_location?.host_type, // 'publisher', 'repository'
      version: data.best_oa_location?.version, // 'publishedVersion', 'acceptedVersion'
      license: data.best_oa_location?.license
    };
    
    // Cache the result
    await cacheOAStatus(cleanDOI, oaData);
    
    console.log(`Unpaywall result for ${cleanDOI}:`, oaData);
    
    return oaData;
    
  } catch (error) {
    console.error('Error querying Unpaywall:', error);
    
    if (error.name === 'AbortError') {
      return { is_oa: false, error: 'Unpaywall API timeout' };
    }
    
    return { is_oa: false, error: error.message };
  }
}

/**
 * Check copyright status for content
 * Main entry point for copyright verification
 */
async function checkCopyright(pageData) {
  try {
    // Ensure academic databases are loaded
    if (academicDatabases.whitelist.length === 0) {
      await loadAcademicDatabases();
    }
    
    const url = pageData.url;
    const domain = pageData.domain || new URL(url).hostname;
    const isPDF = pageData.isPDF || pageData.contentType === 'pdf';
    let doi = pageData.doi;
    
    console.log('Checking copyright for:', { url, domain, isPDF, doi });
    
    // Step 1: Whitelist check (short-circuit - trusted OA sources)
    if (isWhitelisted(domain)) {
      console.log(`✅ Domain ${domain} is whitelisted (trusted OA source)`);
      return {
        allowed: true,
        reason: 'Trusted open access source',
        category: 'whitelist',
        confidence: 'high'
      };
    }
    
    // Step 2: Extract DOI if not already present
    if (!doi && isPDF) {
      doi = extractDOIFromPDFUrl(url);
      if (doi) {
        console.log(`Extracted DOI from PDF URL: ${doi}`);
      }
    }
    
    // Step 3: Handle cases without DOI
    if (!doi) {
      console.log('No DOI found for verification');
      
      // Blacklisted domain without DOI = block
      if (isBlacklisted(domain)) {
        return {
          allowed: false,
          reason: 'Content from subscription database - cannot verify open access status without DOI',
          category: 'blacklist',
          confidence: 'high',
          suggestion: 'Try finding an open access version on preprint servers or institutional repositories'
        };
      }
      
      // PDF without DOI from unknown domain = block (be safe)
      if (isPDF) {
        return {
          allowed: false,
          reason: 'PDF from unknown source - cannot verify copyright status',
          category: 'unknown_pdf',
          confidence: 'medium',
          suggestion: 'Try accessing the article webpage instead of direct PDF, or check if available on open access repositories'
        };
      }
      
      // HTML page from unknown domain without DOI = allow with warning
      return {
        allowed: true,
        reason: 'Unknown source - could not verify copyright status',
        category: 'unknown_html',
        confidence: 'low',
        warning: 'Copyright status could not be verified. Please ensure you have the right to access this content.'
      };
    }
    
    // Step 4: Query Unpaywall for DOI
    console.log(`Checking DOI via Unpaywall: ${doi}`);
    const oaStatus = await queryUnpaywall(doi);
    
    if (oaStatus.error && !oaStatus.is_oa) {
      // Unpaywall query failed
      console.warn('Unpaywall query failed:', oaStatus.error);
      
      // Be conservative: block if we can't verify
      return {
        allowed: false,
        reason: `Could not verify open access status (${oaStatus.error})`,
        category: 'verification_failed',
        confidence: 'low',
        suggestion: 'Check your internet connection and try again, or verify the article is open access manually'
      };
    }
    
    // Step 5: Process Unpaywall result
    if (oaStatus.is_oa) {
      console.log(`✅ DOI ${doi} is open access (${oaStatus.oa_status})`);
      
      const result = {
        allowed: true,
        reason: `Open access confirmed (${oaStatus.oa_status})`,
        category: 'oa_verified',
        confidence: 'high',
        oa_status: oaStatus.oa_status,
        doi: doi
      };
      
      // If there's a better OA location, suggest it
      if (oaStatus.oa_url && oaStatus.oa_url !== url) {
        result.oa_url = oaStatus.oa_url;
        result.oa_host = oaStatus.host_type;
        result.suggestion = `Open access version available at: ${oaStatus.oa_url}`;
      }
      
      return result;
    } else {
      console.log(`❌ DOI ${doi} is not open access (${oaStatus.oa_status || 'closed'})`);
      
      return {
        allowed: false,
        reason: `Article is not openly accessible (status: ${oaStatus.oa_status || 'paywalled'})`,
        category: 'paywalled',
        confidence: 'high',
        doi: doi,
        suggestion: 'Check for preprint versions on arXiv.org, bioRxiv, or contact the author for a copy'
      };
    }
    
  } catch (error) {
    console.error('Error in copyright check:', error);
    
    // On error, be conservative and block
    return {
      allowed: false,
      reason: `Copyright verification failed: ${error.message}`,
      category: 'error',
      confidence: 'low',
      error: error.message
    };
  }
}

/**
 * Get a user-friendly message for copyright status
 */
function getCopyrightMessage(result) {
  if (!result) return 'Copyright status unknown';
  
  const icons = {
    allowed: '✅',
    blocked: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  if (result.allowed) {
    let message = `${icons.allowed} ${result.reason}`;
    
    if (result.warning) {
      message += `\n${icons.warning} ${result.warning}`;
    }
    
    if (result.suggestion && result.oa_url) {
      message += `\n${icons.info} Alternative OA version available`;
    }
    
    return message;
  } else {
    let message = `${icons.blocked} ${result.reason}`;
    
    if (result.suggestion) {
      message += `\n${icons.info} ${result.suggestion}`;
    }
    
    return message;
  }
}

/**
 * Clear OA status cache (for maintenance/debugging)
 */
async function clearOACache() {
  try {
    const allStorage = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(allStorage).filter(key => key.startsWith('oa_cache_'));
    
    if (cacheKeys.length > 0) {
      await chrome.storage.local.remove(cacheKeys);
      console.log(`Cleared ${cacheKeys.length} cached OA status entries`);
    }
    
    return cacheKeys.length;
  } catch (error) {
    console.error('Error clearing OA cache:', error);
    return 0;
  }
}

// Initialize on load
loadAcademicDatabases();

// Export functions for use in other scripts
if (typeof window !== 'undefined') {
  window.copyrightChecker = {
    checkCopyright,
    getCopyrightMessage,
    queryUnpaywall,
    clearOACache,
    loadAcademicDatabases,
    isWhitelisted,
    isBlacklisted
  };
}