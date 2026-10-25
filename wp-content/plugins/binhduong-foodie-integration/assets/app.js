/**
 * Binh Duong Foodie Integration — Frontend JavaScript
 * Handles: tab switching, search, image upload limits, form submission, payment simulation
 */

jQuery(document).ready(function($) {
    'use strict';

    // Word Counter for Review Content (Limit: 800 words)
    const limitReviewWords = (textareaId, counterId) => {
        const $textarea = $(textareaId);
        const $counter = $(counterId);
        if ($textarea.length && $counter.length) {
            const updateCounter = () => {
                const text = $textarea.val() || '';
                const words = text.trim().replace(/\s+/g, ' ').split(' ').filter(w => w.length > 0);
                const wordCount = words.length;
                
                if (wordCount > 800) {
                    // Truncate to exactly 800 words
                    const truncatedText = text.split(/\s+/).slice(0, 800).join(' ');
                    $textarea.val(truncatedText);
                    $counter.text(`800 / 800 từ`).css('color', '#ef4444');
                } else {
                    $counter.text(`${wordCount} / 800 từ`).css('color', '');
                }
            };
            $textarea.on('input keyup change paste', updateCounter);
            updateCounter();
        }
    };
    limitReviewWords('#bdf_content', '#bdf_content_counter');
    limitReviewWords('#bdf_edit_content', '#bdf_edit_content_counter');

    // ===========================================================================
    // 1. LISTINGS: AJAX Filtering & Fetching
    // ===========================================================================
    const $categoryTabs = $('#bdf-category-tabs');
    const $districtFilter = $('#bdf-district-filter');
    const $listingsGrid = $('#bdf-listings-grid');
    const $resultsCount = $('#bdf-results-count');
    const $searchInput = $('#bdf-search-input');
    const $loadMoreBtn = $('#bdf-load-more');
    let isFetching = false;
    let locationData = [];
    let isPopulatingEditModal = false;

    function normalizeLocStr(str) {
        if (!str) return '';
        return str.toString().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^(tinh|thanh pho|thanh_pho|thanh-pho|tp|quan|huyen|thi xa|thi_xa|thi-xa|tx|phuong|xa|tt)[\.\s\-_]*/i, '')
            .replace(/^(h_|tp_|q_|tx_|p_|x_|h-|tp-|q-|tx-|p-|x-)/i, '')
            .replace(/[-_\s]+/g, '')
            .trim();
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function updateEditAddress() {
        if (typeof isPopulatingEditModal !== 'undefined' && isPopulatingEditModal) return;
        const $editAddressDetail = $('#bdf_edit_address_detail');
        const $editAddressVal = $('#bdf_edit_address');
        const $editDistrict = $('#bdf_edit_district');
        const $editProvince = $('#bdf_edit_province');

        var detail = $editAddressDetail.val() ? $editAddressDetail.val().trim() : '';
        var district = ($editDistrict.val() && $editDistrict.val() !== '') ? $editDistrict.find('option:selected').text().trim() : '';
        var province = ($editProvince.val() && $editProvince.val() !== '') ? $editProvince.find('option:selected').text().trim() : '';

        var parts = [];
        if (detail) parts.push(detail);
        if (district && district.indexOf('--') === -1) {
            if (detail.toLowerCase().indexOf(district.toLowerCase()) === -1) {
                parts.push(district);
            }
        }
        if (province && province.indexOf('--') === -1) {
            if (detail.toLowerCase().indexOf(province.toLowerCase()) === -1) {
                parts.push(province);
            }
        }

        if ($editAddressVal.length) {
            $editAddressVal.val(parts.join(', '));
        }
    }

    // Helper function to compress images using Canvas
    function compressImage(file, maxWidth, maxHeight, quality) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = function(event) {
                const img = new Image();
                img.src = event.target.result;
                img.onload = function() {
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(compressedFile);
                        } else {
                            resolve(file);
                        }
                    }, 'image/jpeg', quality);
                };
                img.onerror = function() {
                    resolve(file);
                };
            };
            reader.onerror = function() {
                resolve(file);
            };
        });
    }

    // Load Vietnam provinces database dynamically
    function getProvinceRegion(prov) {
        const c = parseInt(prov.code);
        if (c <= 37) return 'bac';
        if (c >= 38 && c <= 68) return 'trung';
        return 'nam';
    }

    if ($('#bdf_province').length || $('#bdf-province-filter').length || $('#bdf_edit_province').length) {
        $.getJSON(bdfAjax.pluginUrl + 'assets/vietnam_provinces.json', function(data) {
            locationData = data;
            initLocationDropdowns();
        }).fail(function() {
            console.error('Failed to load Vietnam provinces database.');
        });
    }

    function populateProvinces($select, provinces, defaultText, defaultValue = '') {
        $select.empty().append(`<option value="${defaultValue}">${escHtml(defaultText)}</option>`);
        provinces.forEach(prov => {
            $select.append(`<option value="${escHtml(prov.codename)}">${escHtml(prov.name)}</option>`);
        });
    }

    function initLocationDropdowns() {
        // Submission Form Dropdowns
        const $formRegion = $('#bdf_region');
        const $formProvince = $('#bdf_province');
        const $formDistrict = $('#bdf_district');

        // Edit Form Dropdowns
        const $editRegion = $('#bdf_edit_region');
        const $editProvince = $('#bdf_edit_province');
        const $editDistrict = $('#bdf_edit_district');

        // Homepage Filter Dropdowns
        const $filterRegion = $('#bdf-region-filter');
        const $filterProvince = $('#bdf-province-filter');
        const $filterDistrict = $('#bdf-district-filter');

        // Populate all provinces on load
        if ($formProvince.length && locationData) {
            populateProvinces($formProvince, locationData, '-- Chọn Tỉnh / Thành --');
            $formProvince.prop('disabled', false);
        }
        if ($editProvince.length && locationData) {
            populateProvinces($editProvince, locationData, '-- Chọn Tỉnh / Thành --');
            $editProvince.prop('disabled', false);
        }
        if ($filterProvince.length && locationData) {
            $filterProvince.empty().append('<option value="gia_lai" selected>Tỉnh Gia Lai (TP. Pleiku)</option>');
            $filterProvince.prop('disabled', false);
            $filterProvince.val('gia_lai');
            if ($filterRegion.length) {
                $filterRegion.empty().append('<option value="trung" selected>Tây Nguyên – Tỉnh Gia Lai</option>');
                $filterRegion.val('trung');
            }
            const glObj = locationData.find(p => p.codename === 'gia_lai') || locationData[0];
            if (glObj && glObj.districts && $filterDistrict.length) {
                $filterDistrict.empty().append('<option value="all">Tất cả Phường / Xã tại TP. Pleiku & Gia Lai</option>');
                glObj.districts.forEach(dist => {
                    $filterDistrict.append(`<option value="${escHtml(dist.codename)}">${escHtml(dist.name)}</option>`);
                });
                $filterDistrict.prop('disabled', false);
            }
        }

        // --- SUBMISSION FORM EVENTS ---
        if ($formRegion.length) {
            $formRegion.on('change', function() {
                const selectedRegion = $(this).val();
                if (selectedRegion) {
                    const filtered = locationData.filter(p => getProvinceRegion(p) === selectedRegion);
                    populateProvinces($formProvince, filtered, '-- Chọn Tỉnh / Thành --');
                } else {
                    populateProvinces($formProvince, locationData, '-- Chọn Tỉnh / Thành --');
                }
                $formDistrict.empty().append('<option value="">-- Chọn Quận / Huyện --</option>').prop('disabled', true);
            });
        }

        if ($formProvince.length) {
            $formProvince.on('change', function() {
                const selectedProvinceSlug = $(this).val();
                $formDistrict.empty().append('<option value="">-- Chọn Quận / Huyện --</option>').prop('disabled', true);

                if (selectedProvinceSlug) {
                    const provinceObj = locationData.find(p => p.codename === selectedProvinceSlug);
                    if (provinceObj) {
                        // Auto-fill Region
                        const region = getProvinceRegion(provinceObj);
                        if (region) {
                            $formRegion.val(region);
                        }
                        // Populate districts
                        if (provinceObj.districts) {
                            provinceObj.districts.forEach(dist => {
                                $formDistrict.append(`<option value="${escHtml(dist.codename)}">${escHtml(dist.name)}</option>`);
                            });
                            $formDistrict.prop('disabled', false);
                        }
                    }
                }
            });
        }

        // --- EDIT FORM EVENTS ---
        if ($editRegion.length) {
            $editRegion.on('change', function() {
                if (isPopulatingEditModal) return;
                const selectedRegion = $(this).val();
                if (selectedRegion) {
                    const filtered = locationData.filter(p => getProvinceRegion(p) === selectedRegion);
                    populateProvinces($editProvince, filtered, '-- Chọn Tỉnh / Thành --');
                } else {
                    populateProvinces($editProvince, locationData, '-- Chọn Tỉnh / Thành --');
                }
                $editDistrict.empty().append('<option value="">-- Chọn Quận / Huyện --</option>').prop('disabled', true);
            });
        }

        if ($editProvince.length) {
            $editProvince.on('change', function() {
                if (isPopulatingEditModal) return;
                const selectedProvinceSlug = $(this).val();
                $editDistrict.empty().append('<option value="">-- Chọn Quận / Huyện --</option>').prop('disabled', true);

                if (selectedProvinceSlug) {
                    const provinceObj = locationData.find(p => p.codename === selectedProvinceSlug);
                    if (provinceObj) {
                        // Auto-fill Region
                        const region = getProvinceRegion(provinceObj);
                        if (region) {
                            $editRegion.val(region);
                        }
                        // Populate districts
                        if (provinceObj.districts) {
                            provinceObj.districts.forEach(dist => {
                                $editDistrict.append(`<option value="${escHtml(dist.codename)}">${escHtml(dist.name)}</option>`);
                            });
                            $editDistrict.prop('disabled', false);
                        }
                    }
                }
            });
        }

        // --- HOMEPAGE FILTER EVENTS ---
        if ($filterRegion.length) {
            $filterRegion.on('change', function() {
                const selectedRegion = $(this).val();
                const prevProvince = $filterProvince.val();
                
                let filtered = locationData;
                if (selectedRegion && selectedRegion !== 'all') {
                    filtered = locationData.filter(p => getProvinceRegion(p) === selectedRegion);
                }
                
                populateProvinces($filterProvince, filtered, 'Tất cả Tỉnh / Thành', 'all');
                
                if (prevProvince && prevProvince !== 'all' && filtered.some(p => p.codename === prevProvince)) {
                    $filterProvince.val(prevProvince);
                } else {
                    $filterProvince.val("all");
                    $filterDistrict.empty().append('<option value="all">Tất cả Quận / Huyện</option>').prop('disabled', true);
                }

                fetchListings(1, false);
            });
        }

        if ($filterProvince.length) {
            $filterProvince.on('change', function() {
                const selectedProvinceSlug = $(this).val();
                $filterDistrict.empty().append('<option value="all">Tất cả Quận / Huyện</option>');

                if (selectedProvinceSlug && selectedProvinceSlug !== 'all') {
                    const provinceObj = locationData.find(p => p.codename === selectedProvinceSlug);
                    if (provinceObj) {
                        // Auto-fill Region Filter
                        const region = getProvinceRegion(provinceObj);
                        if (region) {
                            $filterRegion.val(region);
                        }
                        // Populate districts
                        if (provinceObj.districts) {
                            provinceObj.districts.forEach(dist => {
                                $filterDistrict.append(`<option value="${escHtml(dist.codename)}">${escHtml(dist.name)}</option>`);
                            });
                            $filterDistrict.prop('disabled', false);
                        }
                    }
                } else {
                    $filterDistrict.prop('disabled', true);
                }

                fetchListings(1, false);
            });
        }

        if ($filterDistrict.length) {
            $filterDistrict.on('change', function() {
                fetchListings(1, false);
            });
        }

        // Auto-update Step 2 Address from Step 1 Details (Submission Form)
        const $addressDetail = $('#bdf_address_detail');
        const $addressVal = $('#bdf_address');

        function updateAddress() {
            var detail = $addressDetail.val() ? $addressDetail.val().trim() : '';
            var district = $formDistrict.val() ? $formDistrict.find('option:selected').text().trim() : '';
            var province = $formProvince.val() ? $formProvince.find('option:selected').text().trim() : '';

            var parts = [];
            if (detail) parts.push(detail);
            if (district && district.indexOf('--') === -1) parts.push(district);
            if (province && province.indexOf('--') === -1) parts.push(province);

            if ($addressVal.length) {
                $addressVal.val(parts.join(', '));
            }
        }

        if ($addressDetail.length) {
            $addressDetail.on('input', updateAddress);
            $formDistrict.on('change', updateAddress);
            $formProvince.on('change', updateAddress);
        }

        // Auto-update Step 2 Address from Step 1 Details (Edit Modal Form)
        const $editAddressDetail = $('#bdf_edit_address_detail');
        if ($editAddressDetail.length) {
            $editAddressDetail.on('input', updateEditAddress);
            $editDistrict.on('change', updateEditAddress);
            $editProvince.on('change', updateEditAddress);
        }
    }

    // Category tab drag-to-scroll & click
    let isDown = false;
    let startX;
    let scrollLeft;
    let hasDragged = false;

    if ($categoryTabs.length) {
        $categoryTabs.on('mousedown', function(e) {
            isDown = true;
            hasDragged = false;
            startX = e.pageX - $categoryTabs.offset().left;
            scrollLeft = $categoryTabs.scrollLeft();
            $categoryTabs.css('cursor', 'grabbing');
        });

        $categoryTabs.on('mouseleave mouseup', function() {
            isDown = false;
            $categoryTabs.css('cursor', 'grab');
        });

        $categoryTabs.on('mousemove', function(e) {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - $categoryTabs.offset().left;
            const walk = (x - startX) * 1.5;
            if (Math.abs(x - startX) > 5) {
                hasDragged = true;
            }
            $categoryTabs.scrollLeft(scrollLeft - walk);
        });
    }

    $categoryTabs.on('click', '.bdf-tab', function(e) {
        if (hasDragged) {
            e.preventDefault();
            return;
        }
        $categoryTabs.find('.bdf-tab').removeClass('bdf-tab--active');
        $(this).addClass('bdf-tab--active');
        
        // Scroll the tab into view within the horizontal container
        const container = $categoryTabs[0];
        if (container) {
            const containerWidth = container.clientWidth;
            const tabOffsetLeft = this.offsetLeft;
            const tabWidth = this.clientWidth;
            container.scrollTo({
                left: tabOffsetLeft - (containerWidth / 2) + (tabWidth / 2),
                behavior: 'smooth'
            });
        }
        
        fetchListings(1, false);
    });

    function getSkeletonsHtml() {
        let html = '';
        for (let i = 0; i < 4; i++) {
            html += `
            <div class="bdf-card bdf-skeleton">
                <div class="bdf-card-image bdf-skeleton-media"></div>
                <div class="bdf-card-body">
                    <div class="bdf-skeleton-text bdf-skeleton-title"></div>
                    <div class="bdf-skeleton-text bdf-skeleton-meta"></div>
                    <div class="bdf-skeleton-text bdf-skeleton-meta" style="width:60%;"></div>
                </div>
            </div>`;
        }
        return html;
    }

    function fetchListings(page = 1, append = false) {
        if (isFetching) return;
        isFetching = true;

        const $spinner = $loadMoreBtn.find('.bdf-spinner');

        // Show loading state
        if (!append) {
            $listingsGrid.html(getSkeletonsHtml());
            $loadMoreBtn.hide();
        } else {
            $loadMoreBtn.prop('disabled', true);
            $spinner.show();
        }

        const category = $categoryTabs.find('.bdf-tab--active').data('filter');
        const selectedRegion = $('#bdf-region-filter').val();
        const province = $('#bdf-province-filter').val();
        const district = $('#bdf-district-filter').val();
        const search = $searchInput.val();

        let provinceParam = '';
        if (province && province !== 'all') {
            provinceParam = province;
        } else if (selectedRegion && selectedRegion !== 'all' && locationData && locationData.length > 0) {
            const regionProvinces = locationData.filter(p => getProvinceRegion(p) === selectedRegion);
            provinceParam = regionProvinces.map(p => p.codename).join(',');
        }

        $.ajax({
            url: '/wp-json/foodie/v1/listings/data.json?v=pleiku247',
            method: 'GET',
            dataType: 'json',
            success: function(rawResponse) {
                if (!append) {
                    $listingsGrid.empty();
                }

                let items = (rawResponse && rawResponse.items) ? rawResponse.items.slice() : [];

                // Client-side filter by category
                if (category && category !== 'all') {
                    const catMap = {
                        'quan-an': 'Quán ăn',
                        'nha-hang': 'Nhà hàng',
                        'ca-phe': 'Cà phê',
                        'an-vat': 'Ăn vặt',
                        'tra-sua': 'Trà sữa',
                        'tiem-banh': 'Tiệm bánh',
                        'dich-vu': 'Dịch vụ',
                        'du-lich': 'Du lịch',
                        'cong-ty': 'Công ty'
                    };
                    const targetCat = catMap[category] || category;
                    items = items.filter(function(it) {
                        return (it.category && it.category.toLowerCase().indexOf(targetCat.toLowerCase()) !== -1) ||
                               (it.category_slug && it.category_slug === category);
                    });
                }

                // Client-side filter by district / ward in Pleiku & Gia Lai
                if (district && district !== 'all') {
                    const distKeywords = {
                        'thanh_pho_pleiku': ['pleiku'],
                        'phuong_hoi_thuong': ['hội thương', 'hoi thuong', 'nguyễn văn trỗi', 'hùng vương', 'trần phú'],
                        'phuong_dien_hong': ['diên hồng', 'dien hong', 'thống nhất', 'hai bà trưng'],
                        'phuong_hoa_lu': ['hoa lư', 'hoa lu', 'phạm văn đồng', 'cù chính lan', 'cách mạng tháng tám'],
                        'phuong_ia_kring': ['ia kring', 'wừu', 'lê thánh tôn', 'hồ tùng mậu'],
                        'phuong_yen_do': ['yên đỗ', 'yen do', 'phan đình phùng'],
                        'phuong_hoi_phu': ['hội phú', 'hoi phu', 'nguyễn tất thành', 'phù đổng'],
                        'phuong_phu_dong': ['phù đổng', 'phu dong'],
                        'phuong_tay_son': ['tây sơn', 'tay son'],
                        'phuong_thong_nhat': ['thống nhất', 'thong nhat'],
                        'phuong_dong_da': ['đống đa', 'dong da'],
                        'phuong_thang_loi': ['thắng lợi', 'thang loi'],
                        'phuong_yen_the': ['yên thế', 'yen the', 'tôn đức thắng'],
                        'xa_bien_ho': ['biển hồ', 'bien ho', 'tân sơn', 'tan son', 'đồi thông']
                    };
                    const kws = distKeywords[district] || [district.replace(/_/g, ' ')];
                    items = items.filter(function(it) {
                        const hay = ((it.address || '') + ' ' + (it.district || '') + ' ' + (it.excerpt || '')).toLowerCase();
                        return kws.some(function(k) { return hay.indexOf(k) !== -1; });
                    });
                }

                // Client-side filter by search keyword
                if (search && search.trim() !== '') {
                    const q = search.trim().toLowerCase();
                    items = items.filter(function(it) {
                        return (it.title && it.title.toLowerCase().indexOf(q) !== -1) ||
                               (it.address && it.address.toLowerCase().indexOf(q) !== -1) ||
                               (it.category && it.category.toLowerCase().indexOf(q) !== -1) ||
                               (it.excerpt && it.excerpt.toLowerCase().indexOf(q) !== -1);
                    });
                }

                const response = {
                    items: items,
                    total: items.length,
                    total_pages: 1
                };

                if (response.items && response.items.length > 0) {
                    response.items.forEach(function(item, index) {
                        const cardHtml = buildCardHtml(item);
                        const $card = $(cardHtml);
                        $card.css({ opacity: 0, transform: 'translateY(15px)' });
                        $listingsGrid.append($card);
                        setTimeout(() => {
                            $card.css({ opacity: 1, transform: 'translateY(0)', transition: 'all .3s ease' });
                        }, index * 30);
                    });
                    $loadMoreBtn.hide();
                } else {
                    if (!append) {
                        $listingsGrid.html(`
                            <div class="bdf-no-results">
                                <div class="bdf-no-results-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="margin: 0 auto; display: block; color: var(--bdf-slate-400);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                                </div>
                                <h3>Không tìm thấy địa điểm phù hợp tại Gia Lai</h3>
                                <p>Thử tìm kiếm từ khóa khác hoặc chọn "Tất cả tại Gia Lai" xem sao nhé!</p>
                            </div>
                        `);
                    }
                    $loadMoreBtn.hide();
                }

                updateResultsCount(response.total || 0);
            },
            error: function() {
                if (!append) {
                    $listingsGrid.html('<div class="bdf-no-results"><h3>Đang tải dữ liệu Gia Lai 247...</h3></div>');
                }
            },
            complete: function() {
                isFetching = false;
                $loadMoreBtn.prop('disabled', false);
                $spinner.hide();
            }
        });
    }

    function updateResultsCount(count) {
        if ($resultsCount.length) {
            $resultsCount.html(count > 0 ? `Hiển thị <strong>${count}</strong> địa điểm thật uy tín tại TP. Pleiku, Gia Lai` : 'Không tìm thấy địa điểm phù hợp tại Gia Lai');
        }
    }

    // Initial count
    if ($listingsGrid.length) {
        const totalCards = $listingsGrid.find('.bdf-card').length;
        updateResultsCount(totalCards);
    }

    // ===========================================================================
    // 2. SEARCH: Debounced search & Single Page Redirect
    // ===========================================================================
    let searchTimeout;

    // Automatically check for URL search parameter on load
    const urlParams = new URLSearchParams(window.location.search);
    const searchParam = urlParams.get('bdf_search');
    if (searchParam && $listingsGrid.length && $searchInput.length) {
        $searchInput.val(searchParam);
        setTimeout(() => {
            fetchListings(1, false);
        }, 100);
    }

    $searchInput.on('input', function() {
        if (!$listingsGrid.length) return; // Ignore input auto-fetch on single post page
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => fetchListings(1, false), 300);
    });

    // Handle enter key press on search input
    $searchInput.on('keypress', function(e) {
        if (e.which === 13) { // Enter key
            e.preventDefault();
            const query = $(this).val().trim();
            if ($listingsGrid.length) {
                fetchListings(1, false);
            } else {
                // Redirect to homepage with search query
                const homeUrl = typeof bdfAjax !== 'undefined' ? bdfAjax.pluginUrl.split('/wp-content/')[0] : window.location.origin;
                window.location.href = homeUrl + '/?bdf_search=' + encodeURIComponent(query);
            }
        }
    });

    $('#bdf-search-btn').on('click', function(e) {
        e.preventDefault();
        const query = $searchInput.val().trim();
        if ($listingsGrid.length) {
            fetchListings(1, false);
        } else {
            // Redirect to homepage with search query
            const homeUrl = typeof bdfAjax !== 'undefined' ? bdfAjax.pluginUrl.split('/wp-content/')[0] : window.location.origin;
            window.location.href = homeUrl + '/?bdf_search=' + encodeURIComponent(query);
        }
    });

    // ===========================================================================
    // 3. VIEW TOGGLE: Grid / List
    // ===========================================================================
    $('.bdf-view-btn').on('click', function() {
        const view = $(this).data('view');
        $('.bdf-view-btn').removeClass('bdf-view-btn--active');
        $(this).addClass('bdf-view-btn--active');

        if (view === 'list') {
            $listingsGrid.addClass('bdf-listings-grid--list');
        } else {
            $listingsGrid.removeClass('bdf-listings-grid--list');
        }
    });

    // ===========================================================================
    // 4. LOAD MORE
    // ===========================================================================
    $loadMoreBtn.on('click', function() {
        const currentPage = parseInt($loadMoreBtn.data('page') || 1);
        const maxPages = parseInt($loadMoreBtn.data('max') || 1);
        const nextPage = currentPage + 1;

        if (nextPage > maxPages) return;
        fetchListings(nextPage, true);
    });

    function bdfGetVipBadgeHtml(context) {
        context = context || 'card';
        const size = context === 'single' ? 26 : (context === 'small' ? 15 : 18);
        return `<span class="bdf-vip-v-badge bdf-vip-v-badge--${context}" title="Gói VIP — Địa điểm nổi bật" aria-label="VIP">` +
            `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">` +
                `<defs>` +
                    `<linearGradient id="bdfVipGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">` +
                        `<stop offset="0%" stop-color="#FFE873"/>` +
                        `<stop offset="35%" stop-color="#F59E0B"/>` +
                        `<stop offset="75%" stop-color="#D97706"/>` +
                        `<stop offset="100%" stop-color="#B45309"/>` +
                    `</linearGradient>` +
                    `<filter id="bdfVipShadow" x="-20%" y="-20%" width="140%" height="140%">` +
                        `<feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#B45309" flood-opacity="0.35"/>` +
                    `</filter>` +
                `</defs>` +
                `<circle cx="12" cy="12" r="10.5" fill="url(#bdfVipGoldGrad)" filter="url(#bdfVipShadow)"/>` +
                `<circle cx="12" cy="12" r="9.2" fill="none" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="0.8"/>` +
                `<path d="M7 8L12 17L17 8" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` +
            `</svg>` +
        `</span>`;
    }

    function buildCardHtml(item) {
        const thumb = item.thumbnail || '';
        const badge = item.categories && item.categories[0] ? `<span class="bdf-card-badge">${escHtml(item.categories[0])}</span>` : '';
        let dist = '';
        if (item.districts && item.districts[0]) {
            let locText = escHtml(item.districts[0]);
            if (item.provinces && item.provinces[0]) {
                locText += `, ${escHtml(item.provinces[0])}`;
            }
            dist = `<div class="bdf-card-district"><span class="bdf-district-tag">${locText}</span></div>`;
        }
        
        let quickInfo = '';
        if (item.phone || item.facebook) {
            quickInfo = `<div class="bdf-card-quick-info">`;
            if (item.phone) {
                quickInfo += `
                    <a href="tel:${escHtml(item.phone)}" class="bdf-quick-btn" title="Gọi điện">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path>
                        </svg>
                    </a>`;
            }
            if (item.facebook) {
                quickInfo += `
                    <a href="${escHtml(item.facebook)}" class="bdf-quick-btn" target="_blank" title="Facebook">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                            <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
                        </svg>
                    </a>`;
            }
            quickInfo += `</div>`;
        }

        const vipBadgeHtml = item.is_vip ? bdfGetVipBadgeHtml('card') : '';

        return `
        <article class="bdf-card">
            <a href="${item.permalink}" class="bdf-card-link">
                <div class="bdf-card-image">
                    ${thumb ? `<img src="${escHtml(thumb)}" alt="${escHtml(item.title)}" loading="lazy" />` : `<div class="bdf-card-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9,22 9,12 15,12 15,22"></polyline></svg><span>Chưa có ảnh</span></div>`}
                    ${badge}
                </div>
                <div class="bdf-card-body">
                    <h3 class="bdf-card-title">${escHtml(item.title)}${vipBadgeHtml}</h3>
                    <div class="bdf-card-meta">
                        ${item.address ? `
                            <div class="bdf-card-meta-item">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                    <circle cx="12" cy="10" r="3"></circle>
                                </svg>
                                <span>${escHtml(item.address)}</span>
                            </div>` : ''}
                        ${item.price_range ? `
                            <div class="bdf-card-meta-item bdf-card-meta-item--price">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                    <line x1="12" y1="1" x2="12" y2="23"></line>
                                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                </svg>
                                <span>${escHtml(item.price_range)}</span>
                            </div>` : ''}
                        ${item.open_hours ? `
                            <div class="bdf-card-meta-item">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12,6 12,12 16,14"></polyline>
                                </svg>
                                <span>${escHtml(item.open_hours)}</span>
                            </div>` : ''}
                        ${item.views !== undefined ? `
                            <div class="bdf-card-meta-item bdf-card-meta-item--views" style="margin-left: auto;">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align: middle;">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                                <span>${item.views.toLocaleString()}</span>
                            </div>` : ''}
                    </div>
                    ${dist}
                </div>
            </a>
            ${quickInfo}
        </article>`;
    }

    function decodeHtml(html) {
        if (!html) return '';
        const txt = document.createElement('textarea');
        txt.innerHTML = html;
        return txt.value;
    }

    function escHtml(str) {
        if (!str) return '';
        const decoded = decodeHtml(str);
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(decoded));
        return div.innerHTML;
    }

    // ===========================================================================
    // 5. POST FORM: Image Upload with Tier Limits
    // ===========================================================================
    const $postForm = $('#bdf-post-form');
    const $fileInput = $('#bdf_images');
    const $dropzone = $('#bdf-dropzone');
    const $previews = $('#bdf-image-previews');
    const $imgCount = $('#bdf-img-count');
    const maxImages = typeof bdfAjax !== 'undefined' ? parseInt(bdfAjax.maxImages) : 1;
    let selectedFiles = [];

    // Drag and drop
    if ($dropzone.length) {
        const dz = $dropzone[0];
        ['dragenter', 'dragover'].forEach(evt => {
            dz.addEventListener(evt, function(e) {
                e.preventDefault();
                e.stopPropagation();
                $dropzone.addClass('bdf-dropzone--dragover');
            });
        });
        ['dragleave', 'drop'].forEach(evt => {
            dz.addEventListener(evt, function(e) {
                e.preventDefault();
                e.stopPropagation();
                $dropzone.removeClass('bdf-dropzone--dragover');
            });
        });
        dz.addEventListener('drop', function(e) {
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            handleFileSelection(files);
        });
    }

    // File input change
    $fileInput.on('change', function() {
        const files = Array.from(this.files).filter(f => f.type.startsWith('image/'));
        handleFileSelection(files);
    });

    function handleFileSelection(newFiles) {
        const remaining = maxImages - selectedFiles.length;
        if (remaining <= 0) {
            showFormError(`Bạn đã đạt giới hạn ${maxImages} ảnh. Xóa bớt ảnh cũ để thêm mới.`);
            return;
        }
        const toAdd = newFiles.slice(0, remaining);
        if (newFiles.length > remaining) {
            showFormError(`Chỉ thêm được ${remaining} ảnh nữa (tối đa ${maxImages} ảnh).`);
        }

        toAdd.forEach(file => {
            selectedFiles.push(file);
            addPreview(file, selectedFiles.length - 1);
        });

        updateImageCount();
    }

    function addPreview(file, index) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const $wrap = $(`
                <div class="bdf-img-preview" data-index="${index}">
                    <img src="${e.target.result}" alt="Preview" />
                    <button type="button" class="bdf-img-remove" data-index="${index}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12" style="display:block;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            `);
            $previews.append($wrap);
        };
        reader.readAsDataURL(file);
    }

    // Remove image
    $previews.on('click', '.bdf-img-remove', function() {
        const idx = parseInt($(this).data('index'));
        selectedFiles[idx] = null;
        $(this).closest('.bdf-img-preview').fadeOut(200, function() {
            $(this).remove();
        });
        updateImageCount();
    });

    function updateImageCount() {
        const count = selectedFiles.filter(f => f !== null).length;
        $imgCount.text(count);

        // Color feedback
        if (count >= maxImages) {
            $imgCount.css('color', '#ef4444');
        } else {
            $imgCount.css('color', '');
        }
    }

    // ===========================================================================
    // 6. POST FORM: Submit via AJAX
    // ===========================================================================
    $postForm.on('submit', function(e) {
        e.preventDefault();

        const $submitBtn = $('#bdf-submit-btn');
        const $btnText = $submitBtn.find('.bdf-btn-text');
        const $spinner = $submitBtn.find('.bdf-spinner');

        // Validation
        const title = $('#bdf_title').val().trim();
        if (!title) {
            showFormError('Vui lòng nhập tên địa điểm.');
            return;
        }

        const imgCount = selectedFiles.filter(f => f !== null).length;
        const isAdmin = typeof bdfAjax !== 'undefined' && (bdfAjax.isAdmin === '1' || bdfAjax.isAdmin === true);
        const isPremium = typeof bdfAjax !== 'undefined' && (bdfAjax.isPremium === '1' || bdfAjax.isPremium === true);
        const maxImages = typeof bdfAjax !== 'undefined' ? parseInt(bdfAjax.maxImages) : (isAdmin ? 30 : (isPremium ? 10 : 1));

        if (isAdmin || isPremium) {
            if (imgCount < 1) {
                showFormError('Vui lòng chọn ít nhất 1 tấm ảnh để đăng.');
                return;
            }
            if (imgCount > maxImages) {
                showFormError(`Bạn chỉ được đăng tối đa ${maxImages} tấm ảnh.`);
                return;
            }
        } else {
            if (imgCount < 1) {
                showFormError('Vui lòng chọn 1 tấm ảnh để đăng.');
                return;
            }
            if (imgCount > 1) {
                showFormError('Thành viên Free chỉ được đăng tối đa 1 tấm ảnh.');
                return;
            }
        }

        // UI feedback
        $submitBtn.prop('disabled', true);
        $spinner.show();
        $btnText.css('opacity', 0.5);
        hideFormMessages();

        // Compress images asynchronously
        const validFiles = selectedFiles.filter(f => f !== null);
        const compressionPromises = validFiles.map(file => compressImage(file, 1600, 1600, 0.8));

        Promise.all(compressionPromises).then(compressedFiles => {
            const formData = new FormData(this);

            // Append dynamic province/district names and slugs
            const $formProvince = $('#bdf_province');
            const $formDistrict = $('#bdf_district');
            if ($formProvince.length && $formProvince.val()) {
                formData.append('bdf_province_slug', $formProvince.val());
                formData.append('bdf_province_name', $formProvince.find('option:selected').text());
            }
            if ($formDistrict.length && $formDistrict.val()) {
                formData.append('bdf_district_slug', $formDistrict.val());
                formData.append('bdf_district_name', $formDistrict.find('option:selected').text());
            }

            // Replace files with compressed versions
            formData.delete('bdf_images[]');
            compressedFiles.forEach(file => {
                formData.append('bdf_images[]', file);
            });

            $.ajax({
                url: bdfAjax.ajaxUrl,
                method: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: function(response) {
                    if (response.success) {
                        showFormSuccess(response.data.message);
                        $postForm[0].reset();
                        selectedFiles = [];
                        $previews.empty();
                        updateImageCount();

                        // Scroll to success
                        $('html, body').animate({ scrollTop: $('#bdf-success-msg').offset().top - 100 }, 400);
                    } else {
                        showFormError(response.data.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
                    }
                },
                error: function() {
                    showFormError('Lỗi kết nối. Vui lòng kiểm tra kết nối mạng và thử lại.');
                },
                complete: function() {
                    $submitBtn.prop('disabled', false);
                    $spinner.hide();
                    $btnText.css('opacity', 1);
                }
            });
        }).catch(err => {
            console.error('Error compressing images:', err);
            // Fallback: submit original files
            const formData = new FormData(this);
            $.ajax({
                url: bdfAjax.ajaxUrl,
                method: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: function(response) {
                    if (response.success) {
                        showFormSuccess(response.data.message);
                        $postForm[0].reset();
                        selectedFiles = [];
                        $previews.empty();
                        updateImageCount();
                        $('html, body').animate({ scrollTop: $('#bdf-success-msg').offset().top - 100 }, 400);
                    } else {
                        showFormError(response.data.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
                    }
                },
                error: function() {
                    showFormError('Lỗi kết nối. Vui lòng kiểm tra kết nối mạng và thử lại.');
                },
                complete: function() {
                    $submitBtn.prop('disabled', false);
                    $spinner.hide();
                    $btnText.css('opacity', 1);
                }
            });
        });
    });

    function showFormSuccess(msg) {
        const $el = $('#bdf-success-msg');
        $el.find('p').text(msg || 'Thành công!');
        $el.slideDown(300);
    }

    function showFormError(msg) {
        const $el = $('#bdf-error-msg');
        $('#bdf-error-text').text(msg);
        $el.slideDown(300);
        setTimeout(() => $el.slideUp(300), 6000);
    }

    function hideFormMessages() {
        $('#bdf-success-msg, #bdf-error-msg').slideUp(200);
    }

    // ===========================================================================
    // 7. UPGRADE: PayOS + Casso Payment Flow
    // ===========================================================================

    let bdfPaymentPoller = null; // Interval ID for polling

    // "Nâng cấp ngay" button — opens PayOS modal
    $(document).on('click', '#bdf-pay-action', function() {
        try {
            const $modal = $('#bdf-payment-modal');
            if (!$modal.length) {
                alert('Không tìm thấy giao diện thanh toán (Modal). Có thể bạn chưa đăng nhập hoặc bị lỗi tải trang.');
                return;
            }

            // Reset modal state
            $('#bdf-payment-status-text').text('Đang tạo mã QR thanh toán...');
            $('#bdf-qr-loader').show();
            $('#bdf-payment-qr').attr('src', '').hide();
            $('#bdf-payment-instruction').text('Đang kết nối đến cổng thanh toán PayOS...');
            $modal.fadeIn(300);

            // Request PayOS QR from backend
            $.ajax({
                url: bdfAjax.ajaxUrl,
                method: 'POST',
                data: {
                    action: 'bdf_create_payos_order',
                    _wpnonce: bdfAjax.nonce,
                },
                success: function(res) {
                    try {
                        if (res.success && res.data.qrCode) {
                            // Display QR image
                            $('#bdf-qr-loader').hide();
                            $('#bdf-payment-status-text').html('Quét mã QR để thanh toán <strong>' + bdfAjax.premiumPrice + '₫</strong>');
                            $('#bdf-payment-qr')
                                .attr('src', res.data.qrCode)
                                .show()
                                .css({ width: '220px', height: '220px', borderRadius: '12px' });
                            $('#bdf-payment-instruction').html(
                                '✅ Dùng app ngân hàng bất kỳ quét mã này.<br>' +
                                '⚡ Tài khoản <strong>tự động kích hoạt</strong> ngay sau khi thanh toán thành công.'
                            );

                            // Open PayOS link if no QR (fallback)
                            if (res.data.checkoutUrl) {
                                const $link = $('<a></a>')
                                    .attr({ href: res.data.checkoutUrl, target: '_blank' })
                                    .addClass('bdf-btn bdf-btn--outline bdf-btn--sm')
                                    .text('Mở trang thanh toán PayOS →')
                                    .css({ display: 'inline-block', marginTop: '12px' });
                                $('#bdf-payment-modal .bdf-modal-content').append($link);
                            }

                            // Start polling for payment completion every 5 seconds
                            bdfStartPaymentPolling();

                        } else if (res.success && res.data.checkoutUrl) {
                            // PayOS configured but no QR image — open checkout page
                            $('#bdf-qr-loader').hide();
                            $('#bdf-payment-status-text').text('Chuyển đến trang thanh toán PayOS...');
                            $('#bdf-payment-instruction').text('Bạn sẽ được chuyển hướng đến trang thanh toán an toàn.');
                            window.open(res.data.checkoutUrl, '_blank');
                            bdfStartPaymentPolling();

                        } else {
                            // PayOS not configured — fallback to bank transfer info
                            let errMsg = (res.data && res.data.message) ? res.data.message : 'Lỗi không xác định.';
                            alert('Lỗi tạo đơn hàng: ' + errMsg);
                            $('#bdf-qr-loader').hide();
                            $('#bdf-payment-status-text').text('Chuyển khoản ngân hàng');
                            $('#bdf-payment-instruction').html(
                                'Quét mã QR trên trang hoặc chuyển khoản thủ công.<br>' +
                                '<strong>Nội dung chuyển khoản:</strong> <code style="background:#eff6ff;padding:2px 8px;border-radius:4px;">' +
                                (bdfAjax.transferCode || '') + '</code>'
                            );
                            bdfStartPaymentPolling();
                        }
                    } catch (err) {
                        alert('Lỗi xử lý JS: ' + err.message);
                    }
                },
                error: function(xhr, status, error) {
                    alert('Lỗi gửi yêu cầu AJAX (Status: ' + status + ', Error: ' + error + ')');
                    $('#bdf-qr-loader').hide();
                    $('#bdf-payment-status-text').text('Không thể tạo đơn thanh toán');
                    $('#bdf-payment-instruction').html(
                        'Vui lòng thử lại hoặc liên hệ quản trị viên.<br>' +
                        'Nếu muốn chuyển khoản trực tiếp: <code>' + (bdfAjax.transferCode || '') + '</code>'
                    );
                }
            });
        } catch (e) {
            alert('Lỗi khởi chạy: ' + e.message);
        }
    });

    // Close payment modal
    $(document).on('click', '#bdf-payment-modal .bdf-modal-backdrop', function() {
        bdfStopPaymentPolling();
        $('#bdf-payment-modal').fadeOut(200);
    });

    // Poll WordPress to check if this user's premium status has changed
    function bdfStartPaymentPolling() {
        bdfStopPaymentPolling(); // clear any existing poller
        bdfPaymentPoller = setInterval(function() {
            $.ajax({
                url: bdfAjax.restUrl + 'check-premium-status',
                method: 'GET',
                headers: { 'X-WP-Nonce': bdfAjax.nonce },
                success: function(res) {
                    if (res && res.is_premium) {
                        bdfStopPaymentPolling();
                        $('#bdf-payment-modal').fadeOut(200);
                        $('#bdf-upgrade-success').fadeIn(300);
                    }
                }
            });
        }, 5000); // Check every 5 seconds
    }

    function bdfStopPaymentPolling() {
        if (bdfPaymentPoller) {
            clearInterval(bdfPaymentPoller);
            bdfPaymentPoller = null;
        }
    }

    // Copy transfer code button
    $(document).on('click', '#bdf-copy-transfer-code', function() {
        const code = $('#bdf-transfer-code').text();
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(function() {
                const $btn = $('#bdf-copy-transfer-code');
                $btn.html('✅').attr('title', 'Đã copy!');
                setTimeout(() => {
                    $btn.html('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>');
                }, 2000);
            });
        }
    });


    // ===========================================================================
    // 8. GOOGLE SIGN-IN  (Form thủ công login/register đã bị xóa — chỉ dùng Google)
    // ===========================================================================
    $('#bdf-google-btn').on('click', function() {
        // Trigger Google One Tap or redirect to Google OAuth
        if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.prompt();
        } else {
            // Fallback: redirect to wp-login.php
            window.location.href = $('a[href*="wp-login.php"]').attr('href') || '/wp-login.php';
        }
    });

    // Google callback handler
    window.bdfHandleGoogleCredential = function(response) {
        $.ajax({
            url: bdfAjax.restUrl + 'google-login',
            method: 'POST',
            headers: { 'X-WP-Nonce': bdfAjax.nonce },
            data: JSON.stringify({ credential: response.credential }),
            contentType: 'application/json',
            success: function(res) {
                if (res.success) {
                    window.location.reload();
                } else {
                    alert(res.message || 'Đăng nhập thất bại.');
                }
            },
            error: function() {
                alert('Lỗi kết nối khi đăng nhập.');
            }
        });
    };

    // Initialize Google Sign-In if client ID exists
    if (typeof bdfAjax !== 'undefined' && document.getElementById('bdf-google-btn')) {
        // Load Google GSI script dynamically
        const gsiScript = document.createElement('script');
        gsiScript.src = 'https://accounts.google.com/gsi/client';
        gsiScript.async = true;
        gsiScript.defer = true;
        gsiScript.onload = function() {
            // Initialize after script loads
            if (typeof google !== 'undefined' && google.accounts) {
                const clientId = bdfAjax.googleClientId;
                if (clientId) {
                    google.accounts.id.initialize({
                        client_id: clientId,
                        callback: window.bdfHandleGoogleCredential,
                    });

                    // Render standard Google button on top of our custom styled button as an overlay
                    $('.bdf-google-btn-wrapper').each(function() {
                        const $wrapper = $(this);
                        const $customBtn = $wrapper.find('button');
                        if ($customBtn.length) {
                            $wrapper.css('position', 'relative');
                            const $overlay = $('<div class="bdf-google-overlay"></div>').css({
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                opacity: 0.01,
                                zIndex: 99,
                                cursor: 'pointer',
                                overflow: 'hidden'
                            });
                            $wrapper.append($overlay);

                            google.accounts.id.renderButton(
                                $overlay[0],
                                {
                                    theme: 'outline',
                                    size: 'large',
                                    width: $customBtn.outerWidth() || 320,
                                    text: 'continue_with',
                                    shape: 'rectangular',
                                    logo_alignment: 'left'
                                }
                            );
                        }
                    });
                }
            }
        };
        document.head.appendChild(gsiScript);
    }

    // ===========================================================================
    // 9. FRONTEND DASHBOARD ACTIONS
    // ===========================================================================
    // Tab switching
    $('.bdf-dashboard-tab-btn').on('click', function() {
        const tab = $(this).data('tab');
        $('.bdf-dashboard-tab-btn').removeClass('bdf-dashboard-tab-btn--active');
        $(this).addClass('bdf-dashboard-tab-btn--active');
        
        $('.bdf-tab-pane').removeClass('bdf-tab-pane--active');
        $(`#bdf-pane-${tab}`).addClass('bdf-tab-pane--active');
    });

    // Profile form submit
    $('#bdf-profile-form').on('submit', function(e) {
        e.preventDefault();
        const $form = $(this);
        const $btn = $form.find('#bdf-profile-submit-btn');
        const $spinner = $btn.find('.bdf-spinner');
        
        $('#bdf-profile-success-msg, #bdf-profile-error-msg').hide();
        $btn.prop('disabled', true);
        $spinner.show();
        
        $.ajax({
            url: bdfAjax.ajaxUrl,
            method: 'POST',
            data: $form.serialize(),
            success: function(response) {
                if (response.success) {
                    $('#bdf-profile-success-msg').slideDown(300);
                    $('.bdf-user-display-name').text($form.find('#bdf_display_name').val());
                    setTimeout(() => $('#bdf-profile-success-msg').slideUp(300), 4000);
                } else {
                    $('#bdf-profile-error-text').text(response.data.message || 'Đã xảy ra lỗi.');
                    $('#bdf-profile-error-msg').slideDown(300);
                }
            },
            error: function() {
                $('#bdf-profile-error-text').text('Lỗi kết nối. Vui lòng thử lại.');
                $('#bdf-profile-error-msg').slideDown(300);
            },
            complete: function() {
                $btn.prop('disabled', false);
                $spinner.hide();
            }
        });
    });

    // Toggle dashboard listing card dropdown menus
    $(document).on('click', '.bdf-db-dropdown-trigger', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $dropdown = $(this).closest('.bdf-db-card-dropdown');
        const isActive = $dropdown.hasClass('bdf-dropdown-active');
        
        // Close all other dropdowns
        $('.bdf-db-card-dropdown').removeClass('bdf-dropdown-active');
        
        if (!isActive) {
            $dropdown.addClass('bdf-dropdown-active');
        }
    });

    // Close dropdowns when clicking outside
    $(document).on('click', function(e) {
        if (!$(e.target).closest('.bdf-db-card-dropdown').length) {
            $('.bdf-db-card-dropdown').removeClass('bdf-dropdown-active');
        }
    });

    // Toggle listing status (Gỡ bài / Đăng lại)
    $(document).on('click', '.bdf-toggle-status-btn', function() {
        const $btn = $(this);
        const post_id = $btn.data('id');
        
        $btn.prop('disabled', true);
        
        $.ajax({
            url: bdfAjax.ajaxUrl,
            method: 'POST',
            data: {
                action: 'bdf_toggle_post_status',
                post_id: post_id
            },
            success: function(response) {
                if (response.success) {
                    alert(response.data.message);
                    window.location.reload();
                } else {
                    alert(response.data.message || 'Lỗi thao tác.');
                    $btn.prop('disabled', false);
                }
            },
            error: function() {
                alert('Lỗi kết nối.');
                $btn.prop('disabled', false);
            }
        });
    });

    // Delete listing
    $(document).on('click', '.bdf-delete-post-btn', function() {
        if (!confirm('Bạn có chắc chắn muốn xóa địa điểm này không? Bài viết sẽ được chuyển vào Thùng rác.')) return;
        
        const $btn = $(this);
        const post_id = $btn.data('id');
        const $card = $(`#bdf-card-${post_id}`);
        
        $btn.prop('disabled', true);
        
        $.ajax({
            url: bdfAjax.ajaxUrl,
            method: 'POST',
            data: {
                action: 'bdf_delete_post',
                post_id: post_id
            },
            success: function(response) {
                if (response.success) {
                    $card.fadeOut(400, function() { 
                        $(this).remove(); 
                        if ($('.bdf-dashboard-card').length === 0) {
                            window.location.reload();
                        }
                    });
                } else {
                    alert(response.data.message || 'Lỗi xóa.');
                    $btn.prop('disabled', false);
                }
            },
            error: function() {
                alert('Lỗi kết nối.');
                $btn.prop('disabled', false);
            }
        });
    });

    // Modal Edit Form Logic
    const $editModal = $('#bdf-edit-modal');
    const $editForm = $('#bdf-edit-post-form');
    let editSelectedFiles = [];
    
    // Open edit modal
    $(document).on('click', '.bdf-edit-post-btn', function() {
        const post_id = $(this).data('id');
        $editModal.fadeIn(300);
        $('body').addClass('bdf-modal-open');
        
        // Clear modal state
        $('#bdf_edit_post_id').val('');
        $editForm[0].reset();
        editSelectedFiles = [];
        $('#bdf-edit-image-previews').empty();
        $('#bdf-edit-existing-images').html('<p class="bdf-input-hint">Đang tải hình ảnh...</p>');
        $('#bdf-edit-success-msg, #bdf-edit-error-msg').hide();
        
        // Load data via AJAX
        $.ajax({
            url: bdfAjax.ajaxUrl,
            method: 'GET',
            data: {
                action: 'bdf_get_post_details',
                post_id: post_id
            },
            success: function(response) {
                if (response.success) {
                    const data = response.data;
                    isPopulatingEditModal = true;

                    // Immediately render existing images first
                    const $existingGrid = $('#bdf-edit-existing-images');
                    $existingGrid.empty();
                    if (data.images && data.images.length > 0) {
                        data.images.forEach(img => {
                            $existingGrid.append(`
                                <div class="bdf-edit-img-item" id="bdf-edit-img-${img.id}">
                                    <img src="${img.url}" alt="Existing image" />
                                    <input type="hidden" name="bdf_existing_images[]" value="${img.id}" />
                                    <button type="button" class="bdf-delete-existing-img-btn" data-id="${img.id}">&times;</button>
                                </div>
                            `);
                        });
                    } else {
                        $existingGrid.html('<p class="bdf-input-hint">Không có hình ảnh nào.</p>');
                    }

                    $('#bdf_edit_post_id').val(data.id);
                    $('#bdf_edit_title').val(data.title);
                    $('#bdf_edit_content').val(data.content).trigger('input');
                    $('#bdf_edit_category').val(data.category);
                    $('#bdf_edit_phone').val(data.phone);
                    $('#bdf_edit_price').val(data.price_range);
                    $('#bdf_edit_hours').val(data.open_hours);
                    $('#bdf_edit_facebook').val(data.facebook);
                    $('#bdf_edit_instagram').val(data.instagram);
                    $('#bdf_edit_tiktok').val(data.tiktok);
                    $('#bdf_edit_website').val(data.website);
                    $('#bdf_edit_youtube').val(data.youtube);

                    var rawAddr = (data.address || '').trim();

                    try {
                        // 1. Resolve Province and District from locationData
                        let provObj = null;
                        if (locationData && locationData.length > 0) {
                            if (data.province_slug) {
                                provObj = locationData.find(p => p.codename === data.province_slug || normalizeLocStr(p.codename) === normalizeLocStr(data.province_slug));
                            }
                            if (!provObj && data.province_name) {
                                provObj = locationData.find(p => normalizeLocStr(p.name) === normalizeLocStr(data.province_name));
                            }
                        }

                        let matchedDist = null;
                        const $editDistrict = $('#bdf_edit_district');
                        const $editProvince = $('#bdf_edit_province');
                        const $editRegion = $('#bdf_edit_region');

                        if (provObj) {
                            const region = getProvinceRegion(provObj);
                            if (region) {
                                $editRegion.val(region);
                                const filtered = locationData.filter(p => getProvinceRegion(p) === region);
                                populateProvinces($editProvince, filtered, '-- Chọn Tỉnh / Thành --');
                            }
                            $editProvince.val(provObj.codename);

                            // Populate districts
                            $editDistrict.empty().append('<option value="">-- Chọn Quận / Huyện --</option>');
                            if (provObj.districts && provObj.districts.length > 0) {
                                provObj.districts.forEach(dist => {
                                    $editDistrict.append(`<option value="${escHtml(dist.codename)}">${escHtml(dist.name)}</option>`);
                                });
                                $editDistrict.prop('disabled', false);

                                // Match district by codename or slug
                                if (data.district_slug) {
                                    matchedDist = provObj.districts.find(d => d.codename === data.district_slug || normalizeLocStr(d.codename) === normalizeLocStr(data.district_slug));
                                }
                                // Match district by name
                                if (!matchedDist && data.district_name) {
                                    matchedDist = provObj.districts.find(d => normalizeLocStr(d.name) === normalizeLocStr(data.district_name));
                                }
                                // Match slug against name
                                if (!matchedDist && data.district_slug) {
                                    matchedDist = provObj.districts.find(d => normalizeLocStr(d.name) === normalizeLocStr(data.district_slug));
                                }
                            }

                            if (matchedDist) {
                                $editDistrict.val(matchedDist.codename);
                            } else if (data.district_slug || data.district_name) {
                                var valToUse = data.district_slug || data.district_name;
                                var textToUse = data.district_name || data.district_slug;
                                $editDistrict.append(new Option(textToUse, valToUse, true, true));
                                $editDistrict.val(valToUse);
                                $editDistrict.prop('disabled', false);
                            }
                        }

                        // 2. Extract detailed address cleanly
                        var distName = matchedDist ? matchedDist.name : (data.district_name || '');
                        var provName = provObj ? provObj.name : (data.province_name || '');

                        // Remove consecutive duplicate district names if present
                        if (distName) {
                            var escapedDist = escapeRegex(distName);
                            var dupRegex = new RegExp('(' + escapedDist + '[,\\s]+)+' + escapedDist, 'gi');
                            rawAddr = rawAddr.replace(dupRegex, distName);
                        }

                        var detailAddr = rawAddr;
                        // Strip province name from the end
                        if (provName) {
                            var pIdx = detailAddr.lastIndexOf(provName);
                            if (pIdx !== -1 && pIdx >= detailAddr.length - provName.length - 10) {
                                detailAddr = detailAddr.substring(0, pIdx).replace(/,\s*$/, '').trim();
                            }
                        }
                        // Strip district name from the end
                        if (distName) {
                            var dIdx = detailAddr.lastIndexOf(distName);
                            if (dIdx !== -1 && dIdx >= detailAddr.length - distName.length - 10) {
                                detailAddr = detailAddr.substring(0, dIdx).replace(/,\s*$/, '').trim();
                            }
                        }

                        // Fallback to comma slicing if stripping left empty or did not change
                        if (!detailAddr) {
                            detailAddr = rawAddr;
                        }
                        if (detailAddr === rawAddr && rawAddr.indexOf(',') !== -1) {
                            var parts = rawAddr.split(',');
                            if (parts.length >= 3) {
                                detailAddr = parts.slice(0, parts.length - 2).join(',').trim();
                            } else if (parts.length === 2) {
                                detailAddr = parts[0].trim();
                            }
                        }

                        $('#bdf_edit_address_detail').val(detailAddr);
                    } catch (locErr) {
                        console.error('Lỗi phân tích địa chỉ:', locErr);
                        $('#bdf_edit_address_detail').val(rawAddr);
                    } finally {
                        // Done loading modal data
                        isPopulatingEditModal = false;

                        // Update full address field
                        try {
                            if (typeof updateEditAddress === 'function') {
                                updateEditAddress();
                            }
                        } catch (e) {
                            console.error(e);
                        }
                        if (!$('#bdf_edit_address').val() && rawAddr) {
                            $('#bdf_edit_address').val(rawAddr);
                        }
                    }
                } else {
                    alert(response.data.message || 'Lỗi tải dữ liệu.');
                    closeEditModal();
                }
            },
            error: function() {
                alert('Lỗi kết nối.');
                closeEditModal();
            }
        });
    });
    
    // Close modal
    $('.bdf-close-modal-btn').on('click', closeEditModal);
    $editModal.on('click', function(e) {
        if (e.target === this) closeEditModal();
    });
    
    function closeEditModal() {
        $editModal.fadeOut(200);
        $('body').removeClass('bdf-modal-open');
    }
    
    // Delete existing image click
    $(document).on('click', '.bdf-delete-existing-img-btn', function() {
        $(this).parent().remove();
        if ($('#bdf-edit-existing-images .bdf-edit-img-item').length === 0) {
            $('#bdf-edit-existing-images').html('<p class="bdf-input-hint">Không có hình ảnh nào.</p>');
        }
    });

    // Image upload selection and previews for edit form
    const $editDropzone = $('#bdf-edit-dropzone');
    const $editFileInput = $('#bdf_edit_images');
    const $editPreviews = $('#bdf-edit-image-previews');
    
    $editDropzone.on('dragover', function(e) {
        e.preventDefault();
        $(this).addClass('bdf-dropzone--dragover');
    });
    $editDropzone.on('dragleave', function() {
        $(this).removeClass('bdf-dropzone--dragover');
    });
    $editDropzone.on('drop', function(e) {
        e.preventDefault();
        $(this).removeClass('bdf-dropzone--dragover');
        const files = e.originalEvent.dataTransfer.files;
        handleEditFileSelection(files);
    });
    $editFileInput.on('change', function() {
        handleEditFileSelection(this.files);
    });
    
    function handleEditFileSelection(files) {
        const isAdmin = typeof bdfAjax !== 'undefined' && (bdfAjax.isAdmin === '1' || bdfAjax.isAdmin === true);
        const isPremiumUser = typeof bdfAjax !== 'undefined' && (bdfAjax.isPremium === '1' || bdfAjax.isPremium === true);
        const maxImages = typeof bdfAjax !== 'undefined' ? parseInt(bdfAjax.maxImages) : (isAdmin ? 30 : (isPremiumUser ? 10 : 1));
        const existingCount = $('#bdf-edit-existing-images .bdf-edit-img-item').length;
        
        for (let i = 0; i < files.length; i++) {
            if (existingCount + editSelectedFiles.length >= maxImages) {
                alert(`Bạn chỉ được đăng tối đa ${maxImages} ảnh. Vui lòng nâng cấp hoặc gỡ bớt ảnh hiện tại.`);
                break;
            }
            const file = files[i];
            if (file.type.match('image.*')) {
                editSelectedFiles.push(file);
                const reader = new FileReader();
                reader.onload = function(e) {
                    const index = editSelectedFiles.length - 1;
                    $editPreviews.append(`
                        <div class="bdf-preview-item" data-index="${index}">
                           <img src="${e.target.result}" alt="Preview" />
                           <button type="button" class="bdf-delete-preview-btn bdf-delete-edit-preview-btn">&times;</button>
                        </div>
                    `);
                };
                reader.readAsDataURL(file);
            }
        }
    }
    
    // Delete preview click in edit form
    $(document).on('click', '.bdf-delete-edit-preview-btn', function() {
        const index = $(this).parent().data('index');
        editSelectedFiles.splice(index, 1);
        $(this).parent().remove();
        $editPreviews.find('.bdf-preview-item').each(function(i) {
            $(this).attr('data-index', i);
        });
    });

    // Submit edit form
    $editForm.on('submit', function(e) {
        e.preventDefault();
        const $form = $(this);
        const $btn = $('#bdf-edit-submit-btn');
        const $spinner = $btn.find('.bdf-spinner');
        
        $('#bdf-edit-success-msg, #bdf-edit-error-msg').hide();
        $btn.prop('disabled', true);
        $spinner.show();

        // Validation
        const existingCount = $('#bdf-edit-existing-images .bdf-edit-img-item').length;
        const newCount = editSelectedFiles.length;
        const totalCount = existingCount + newCount;
        const isAdmin = typeof bdfAjax !== 'undefined' && (bdfAjax.isAdmin === '1' || bdfAjax.isAdmin === true);
        const isPremiumUser = typeof bdfAjax !== 'undefined' && (bdfAjax.isPremium === '1' || bdfAjax.isPremium === true);
        const maxImages = typeof bdfAjax !== 'undefined' ? parseInt(bdfAjax.maxImages) : (isAdmin ? 30 : (isPremiumUser ? 10 : 1));

        if (isAdmin || isPremiumUser) {
            if (totalCount < 1) {
                $('#bdf-edit-error-text').text('Vui lòng giữ lại hoặc tải lên ít nhất 1 tấm ảnh.');
                $('#bdf-edit-error-msg').slideDown(300);
                $btn.prop('disabled', false);
                $spinner.hide();
                return;
            }
            if (totalCount > maxImages) {
                $('#bdf-edit-error-text').text(`Bạn chỉ được có tối đa ${maxImages} tấm ảnh.`);
                $('#bdf-edit-error-msg').slideDown(300);
                $btn.prop('disabled', false);
                $spinner.hide();
                return;
            }
        } else {
            if (totalCount < 1) {
                $('#bdf-edit-error-text').text('Vui lòng giữ lại hoặc tải lên ít nhất 1 tấm ảnh.');
                $('#bdf-edit-error-msg').slideDown(300);
                $btn.prop('disabled', false);
                $spinner.hide();
                return;
            }
            if (totalCount > 1) {
                $('#bdf-edit-error-text').text('Thành viên Free chỉ được có tối đa 1 tấm ảnh.');
                $('#bdf-edit-error-msg').slideDown(300);
                $btn.prop('disabled', false);
                $spinner.hide();
                return;
            }
        }
        
        // Compress images asynchronously before submission
        const compressionPromises = editSelectedFiles.map(file => compressImage(file, 1600, 1600, 0.8));

        Promise.all(compressionPromises).then(compressedFiles => {
            const formData = new FormData($form[0]);
            
            // Append compressed files
            compressedFiles.forEach(file => {
                formData.append('bdf_images[]', file);
            });
            
            // Append province/district details
            let provinceName = ($('#bdf_edit_province').val()) ? $('#bdf_edit_province option:selected').text().trim() : '';
            let provinceSlug = $('#bdf_edit_province').val() || '';
            let districtName = ($('#bdf_edit_district').val()) ? $('#bdf_edit_district option:selected').text().trim() : '';
            let districtSlug = $('#bdf_edit_district').val() || '';

            if (provinceName.indexOf('--') !== -1) provinceName = '';
            if (districtName.indexOf('--') !== -1) districtName = '';

            formData.append('bdf_province_name', provinceName);
            formData.append('bdf_province_slug', provinceSlug);
            formData.append('bdf_district_name', districtName);
            formData.append('bdf_district_slug', districtSlug);
            formData.append('bdf_address', $('#bdf_edit_address').val() || '');
            
            formData.append('security', $form.find('input[name="security"]').val());
            
            $.ajax({
                url: bdfAjax.ajaxUrl,
                method: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: function(response) {
                    if (response.success) {
                        $('#bdf-edit-success-msg').slideDown(300);
                        setTimeout(() => {
                            closeEditModal();
                            window.location.reload();
                        }, 1500);
                    } else {
                        $('#bdf-edit-error-text').text(response.data.message || 'Đã xảy ra lỗi.');
                        $('#bdf-edit-error-msg').slideDown(300);
                    }
                },
                error: function() {
                    $('#bdf-edit-error-text').text('Lỗi kết nối. Vui lòng thử lại.');
                    $('#bdf-edit-error-msg').slideDown(300);
                },
                complete: function() {
                    $btn.prop('disabled', false);
                    $spinner.hide();
                }
            });
        }).catch(err => {
            console.error('Error compressing images during edit:', err);
            // Fallback: submit original files
            const formData = new FormData($form[0]);
            editSelectedFiles.forEach(file => {
                formData.append('bdf_images[]', file);
            });
            let provinceName = ($('#bdf_edit_province').val()) ? $('#bdf_edit_province option:selected').text().trim() : '';
            let provinceSlug = $('#bdf_edit_province').val() || '';
            let districtName = ($('#bdf_edit_district').val()) ? $('#bdf_edit_district option:selected').text().trim() : '';
            let districtSlug = $('#bdf_edit_district').val() || '';

            if (provinceName.indexOf('--') !== -1) provinceName = '';
            if (districtName.indexOf('--') !== -1) districtName = '';

            formData.append('bdf_province_name', provinceName);
            formData.append('bdf_province_slug', provinceSlug);
            formData.append('bdf_district_name', districtName);
            formData.append('bdf_district_slug', districtSlug);
            formData.append('bdf_address', $('#bdf_edit_address').val() || '');
            formData.append('security', $form.find('input[name="security"]').val());
            $.ajax({
                url: bdfAjax.ajaxUrl,
                method: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: function(response) {
                    if (response.success) {
                        $('#bdf-edit-success-msg').slideDown(300);
                        setTimeout(() => {
                            closeEditModal();
                            window.location.reload();
                        }, 1500);
                    } else {
                        $('#bdf-edit-error-text').text(response.data.message || 'Đã xảy ra lỗi.');
                        $('#bdf-edit-error-msg').slideDown(300);
                    }
                },
                error: function() {
                    $('#bdf-edit-error-text').text('Lỗi kết nối. Vui lòng thử lại.');
                    $('#bdf-edit-error-msg').slideDown(300);
                },
                complete: function() {
                    $btn.prop('disabled', false);
                    $spinner.hide();
                }
            });
        });
    });

    // Admin Quick Approve / Unapprove
    $(document).on('click', '.bdf-admin-approve-btn', function() {
        const $btn = $(this);
        const post_id = $btn.data('id');
        
        $btn.prop('disabled', true);
        
        $.ajax({
            url: bdfAjax.ajaxUrl,
            method: 'POST',
            data: {
                action: 'bdf_quick_approve_post',
                post_id: post_id
            },
            success: function(response) {
                if (response.success) {
                    alert(response.data.message);
                    window.location.reload();
                } else {
                    alert(response.data.message || 'Lỗi thao tác.');
                    $btn.prop('disabled', false);
                }
            },
            error: function() {
                alert('Lỗi kết nối.');
                $btn.prop('disabled', false);
            }
        });
    });

    $(document).on('click', '.bdf-admin-unapprove-btn', function() {
        const $btn = $(this);
        const post_id = $btn.data('id');
        
        $btn.prop('disabled', true);
        
        $.ajax({
            url: bdfAjax.ajaxUrl,
            method: 'POST',
            data: {
                action: 'bdf_quick_unpublish_post',
                post_id: post_id
            },
            success: function(response) {
                if (response.success) {
                    alert(response.data.message);
                    window.location.reload();
                } else {
                    alert(response.data.message || 'Lỗi thao tác.');
                    $btn.prop('disabled', false);
                }
            },
            error: function() {
                alert('Lỗi kết nối.');
                $btn.prop('disabled', false);
            }
        });
    });

    // ===========================================================================
    // 9. CATEGORY MANAGEMENT (Admin Only)
    // ===========================================================================
    // Preset icon click selector
    $(document).on('click', '.bdf-preset-icon-option', function() {
        $('.bdf-preset-icon-option').css({
            'border-color': 'var(--bdf-border)',
            'background': 'transparent'
        });
        $(this).css({
            'border-color': 'var(--bdf-primary)',
            'background': 'var(--bdf-blue-50, #eff6ff)'
        });
        const svg = $(this).attr('data-svg');
        $('#bdf_cat_svg').val(svg);
    });

    // Add new category via AJAX
    $('#bdf-add-cat-form').on('submit', function(e) {
        e.preventDefault();
        const $form = $(this);
        const $btn = $('#bdf-cat-submit-btn');
        const $spinner = $btn.find('.bdf-spinner');
        
        $('#bdf-cat-success-msg, #bdf-cat-error-msg').hide();
        $btn.prop('disabled', true);
        $spinner.show();
        
        const catName = $('#bdf_cat_name').val();
        const catSlug = $('#bdf_cat_slug').val();
        const catSvg = $('#bdf_cat_svg').val();
        
        $.ajax({
            url: bdfAjax.ajaxUrl,
            method: 'POST',
            data: {
                action: 'bdf_add_category',
                bdf_cat_name: catName,
                bdf_cat_slug: catSlug,
                bdf_cat_svg: catSvg
            },
            success: function(response) {
                if (response.success) {
                    $('#bdf-cat-success-msg').slideDown(300);
                    
                    // Clear inputs
                    $form[0].reset();
                    $('.bdf-preset-icon-option').css({
                        'border-color': 'var(--bdf-border)',
                        'background': 'transparent'
                    });

                    // Append new category row to table
                    const newRow = `
                        <tr style="border-bottom: 1px solid var(--bdf-border); font-size: 0.85rem; color:#334155;" class="bdf-cat-row" data-id="${response.data.term_id}">
                            <td style="padding: 10px 8px;">
                                <div style="width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:var(--bdf-primary);">
                                    ${response.data.svg}
                                </div>
                            </td>
                            <td style="padding: 10px 8px; font-weight:700;">${escHtml(response.data.name)}</td>
                            <td style="padding: 10px 8px; font-family:monospace; color:#64748b;">${escHtml(response.data.slug)}</td>
                            <td style="padding: 10px 8px; text-align:right;">
                                <button type="button" class="bdf-btn bdf-btn--danger-outline bdf-btn--sm bdf-delete-cat-btn" data-id="${response.data.term_id}" style="padding:4px 8px; font-size:0.75rem; border-radius:4px; cursor:pointer;">
                                    Xóa
                                </button>
                            </td>
                        </tr>`;
                    $('#bdf-categories-table-body').append(newRow);
                    
                    setTimeout(() => {
                        $('#bdf-cat-success-msg').slideUp(300);
                    }, 2000);
                } else {
                    $('#bdf-cat-error-text').text(response.data.message || 'Đã xảy ra lỗi.');
                    $('#bdf-cat-error-msg').slideDown(300);
                }
            },
            error: function() {
                $('#bdf-cat-error-text').text('Lỗi kết nối. Vui lòng thử lại.');
                $('#bdf-cat-error-msg').slideDown(300);
            },
            complete: function() {
                $btn.prop('disabled', false);
                $spinner.hide();
            }
        });
    });

    // Delete category via AJAX
    $(document).on('click', '.bdf-delete-cat-btn', function() {
        const $btn = $(this);
        const termId = $btn.data('id');
        
        if (!confirm('Bạn có chắc chắn muốn xóa danh mục này? Các địa điểm thuộc danh mục này sẽ hiển thị dưới dạng Chưa phân loại.')) {
            return;
        }
        
        $btn.prop('disabled', true);
        
        $.ajax({
            url: bdfAjax.ajaxUrl,
            method: 'POST',
            data: {
                action: 'bdf_delete_category',
                term_id: termId
            },
            success: function(response) {
                if (response.success) {
                    $btn.closest('.bdf-cat-row').fadeOut(300, function() {
                        $(this).remove();
                    });
                } else {
                    alert(response.data.message || 'Lỗi thao tác.');
                    $btn.prop('disabled', false);
                }
            },
            error: function() {
                alert('Lỗi kết nối.');
                $btn.prop('disabled', false);
            }
        });
    });

    // ===========================================================================
    // 10. SMOOTH ANIMATIONS on scroll
    // ===========================================================================
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

        document.querySelectorAll('.bdf-card, .bdf-form-section, .bdf-pricing-card').forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            el.style.transition = 'opacity .5s ease, transform .5s ease';
            observer.observe(el);
        });
    }

    // ===========================================================================
    // 11. CUSTOM FOOTER MOBILE ACCORDION
    // ===========================================================================
    $(document).on('click', '.mobile-accordion-trigger', function() {
        if ($(window).width() <= 768) {
            const $col = $(this).closest('.bdf-footer-col');
            const $content = $col.find('.accordion-content');
            
            $col.toggleClass('active');
            $content.stop(true, true).slideToggle(250);
        }
    });

    // ===========================================================================
    // 12. LIGHTBOX: Gallery Image Zoom & Navigation
    // ===========================================================================
    const $galleryGrid = $('.bdf-gallery-grid');
    if ($galleryGrid.length) {
        // Build lightbox overlay HTML
        const $lightbox = $(`
            <div class="bdf-lightbox-overlay bdf-lb-overlay" style="display: none;">
                <button type="button" class="bdf-lightbox-close bdf-lb-close" aria-label="Đóng">&times;</button>
                <button type="button" class="bdf-lightbox-prev bdf-lb-prev" aria-label="Ảnh trước">&lsaquo;</button>
                <div class="bdf-lightbox-content bdf-lb-content">
                    <img class="bdf-lightbox-image bdf-lb-image" alt="Zoomed Image" />
                    <div class="bdf-lightbox-caption bdf-lb-caption"></div>
                </div>
                <button type="button" class="bdf-lightbox-next bdf-lb-next" aria-label="Ảnh sau">&rsaquo;</button>
            </div>
        `);
        $('body').append($lightbox);

        const $lightboxImg = $lightbox.find('.bdf-lightbox-image');
        const $lightboxCaption = $lightbox.find('.bdf-lightbox-caption');
        const $images = $galleryGrid.find('.bdf-gallery-item img');
        let currentIndex = 0;

        if ($images.length <= 1) {
            $lightbox.addClass('single-image');
        }

        // Open Lightbox
        $galleryGrid.on('click', '.bdf-gallery-item img', function() {
            const src = $(this).attr('src');
            const alt = $(this).attr('alt') || '';
            currentIndex = $images.index(this);

            showImage(src, alt);
            $lightbox.css('display', 'flex');
            // Force reflow
            $lightbox[0].offsetHeight;
            $lightbox.addClass('active');
        });

        // Show image helper
        function showImage(src, alt) {
            if (!src) return;
            $lightboxImg.attr('src', src);
            $lightboxCaption.text(alt || '');
        }

        // Navigate Next
        function nextImage() {
            if ($images.length <= 1) return;
            currentIndex = (currentIndex + 1) % $images.length;
            const $nextImg = $images.eq(currentIndex);
            showImage($nextImg.attr('src'), $nextImg.attr('alt') || '');
        }

        // Navigate Prev
        function prevImage() {
            if ($images.length <= 1) return;
            currentIndex = (currentIndex - 1 + $images.length) % $images.length;
            const $prevImg = $images.eq(currentIndex);
            showImage($prevImg.attr('src'), $prevImg.attr('alt') || '');
        }

        // Click events
        $lightbox.find('.bdf-lightbox-next, .bdf-lb-next').on('click', function(e) {
            e.stopPropagation();
            nextImage();
        });

        $lightbox.find('.bdf-lightbox-prev, .bdf-lb-prev').on('click', function(e) {
            e.stopPropagation();
            prevImage();
        });

        $lightbox.find('.bdf-lightbox-close, .bdf-lb-close').on('click', function() {
            closeLightbox();
        });

        $lightbox.on('click', function(e) {
            if (e.target === this || $(e.target).hasClass('bdf-lightbox-content') || $(e.target).hasClass('bdf-lb-content')) {
                closeLightbox();
            }
        });

        function closeLightbox() {
            $lightbox.removeClass('active');
            setTimeout(() => {
                $lightbox.hide();
                $lightboxImg.removeAttr('src');
            }, 300);
        }

        // Keyboard navigation
        $(document).on('keydown', function(e) {
            if (!$lightbox.hasClass('active')) return;
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowRight') nextImage();
            if (e.key === 'ArrowLeft') prevImage();
        });
    }

    // Swipe gestures to slide to next/prev post
    (function() {
        var startX = 0;
        var startY = 0;
        var threshold = 120; // min distance for swipe in px
        var restraint = 100; // max distance allowed in y-axis to be considered a horizontal swipe
        var allowedTime = 350; // max time allowed to travel that distance
        var startTime = 0;

        var $prevLink = $('#bdf-nav-prev-link');
        var $nextLink = $('#bdf-nav-next-link');

        // If no navigation links exist, do nothing
        if (!$prevLink.length && !$nextLink.length) return;

        // Create swipe toast helper dynamically if it doesn't exist
        var $toast = $('<div class="bdf-swipe-toast"></div>').appendTo('body');

        function showSwipeToast(message, isPrev) {
            var iconHtml = isPrev 
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="15 18 9 12 15 6"></polyline></svg>' 
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20"><polyline points="9 18 15 12 9 6"></polyline></svg>';
            $toast.html(iconHtml + '<span>' + message + '</span>');
            $toast.addClass('active');
        }

        $(document).on('touchstart', function(e) {
            // Ignore touches on map, input, textarea, select, list of links, galleries, or slides
            var ignoreList = 'input, textarea, select, button, a, iframe, .bdf-gallery, .bdf-lightbox-overlay, .mapboxgl-canvas';
            if ($(e.target).closest(ignoreList).length > 0) return;

            var touchobj = e.changedTouches[0];
            startX = touchobj.pageX;
            startY = touchobj.pageY;
            startTime = new Date().getTime();
        });

        $(document).on('touchend', function(e) {
            // Ignore if touch started on interactive element
            var ignoreList = 'input, textarea, select, button, a, iframe, .bdf-gallery, .bdf-lightbox-overlay, .mapboxgl-canvas';
            if ($(e.target).closest(ignoreList).length > 0) return;

            var touchobj = e.changedTouches[0];
            var distX = touchobj.pageX - startX;
            var distY = touchobj.pageY - startY;
            var elapsedTime = new Date().getTime() - startTime;

            if (elapsedTime <= allowedTime) {
                // Horizontal swipe check: abs(distX) >= threshold and abs(distY) <= restraint
                if (Math.abs(distX) >= threshold && Math.abs(distY) <= restraint) {
                    if (distX > 0) {
                        // Swipe Right (go to Prev)
                        if ($prevLink.length) {
                            showSwipeToast('Đang quay lại bài trước...', true);
                            setTimeout(function() {
                                window.location.href = $prevLink.attr('href');
                            }, 400);
                        }
                    } else {
                        // Swipe Left (go to Next)
                        if ($nextLink.length) {
                            showSwipeToast('Đang qua bài tiếp theo...', false);
                            setTimeout(function() {
                                window.location.href = $nextLink.attr('href');
                            }, 400);
                        }
                    }
                }
            }
        });
        
        // Hide mobile navigation dock when scrolling down to give more content space, show when scrolling up
        var lastScrollTop = 0;
        var $mobileDock = $('.bdf-mobile-nav-dock');
        if ($mobileDock.length) {
            $(window).on('scroll', function() {
                var st = $(this).scrollTop();
                if (st > lastScrollTop && st > 100) {
                    // Scroll Down - Hide dock
                    $mobileDock.css({
                        'transform': 'translateX(-50%) translateY(100px)',
                        'opacity': '0'
                    });
                } else {
                    // Scroll Up - Show dock
                    $mobileDock.css({
                        'transform': 'translateX(-50%) translateY(0)',
                        'opacity': '1'
                    });
                }
                lastScrollTop = st;
            });
        }
    })();

    // Drag to scroll for Related Locations slider
    (function() {
        var $slider = $('.bdf-related-slider');
        if (!$slider.length) return;

        var slider = $slider[0];
        var isDown = false;
        var startX;
        var scrollLeft;
        var dragThreshold = 5;
        var hasDragged = false;
        var mouseDownTime;

        $slider.on('mousedown', function(e) {
            isDown = true;
            $slider.addClass('active');
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
            hasDragged = false;
            window.bdfSliderDragging = false;
            mouseDownTime = new Date().getTime();
        });

        $(document).on('mouseup', function(e) {
            if (!isDown) return;
            isDown = false;
            $slider.removeClass('active');
        });

        $slider.on('mouseleave', function() {
            if (!isDown) return;
            isDown = false;
            $slider.removeClass('active');
        });

        $slider.on('mousemove', function(e) {
            if (!isDown) return;
            var x = e.pageX - slider.offsetLeft;
            var walk = (x - startX) * 1.5; // scroll speed multiplier
            
            if (Math.abs(walk) > dragThreshold) {
                hasDragged = true;
                window.bdfSliderDragging = true;
                e.preventDefault();
                slider.scrollLeft = scrollLeft - walk;
            }
        });

        // Prevent navigation on drag
        $slider.find('a').on('click', function(e) {
            var clickDuration = new Date().getTime() - mouseDownTime;
            // If mouse moved or was held down for drag, prevent click navigation
            if (hasDragged || clickDuration > 300) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return false;
            }
        });

        // Prevent default browser dragging ghost behavior on both links and images
        $slider.find('a, img').on('dragstart', function(e) {
            e.preventDefault();
        });

        // Ensure drag state is reset if mouseup occurs anywhere, even outside the window
        $(window).on('mouseup blur', function() {
            if (isDown) {
                isDown = false;
                $slider.removeClass('active');
            }
        });
    })();

    // Infinite loading for Related Locations slider
    (function() {
        var $slider = $('.bdf-related-slider');
        if (!$slider.length) return;

        var slider = $slider[0];
        var isAjaxLoading = false;
        var hasMorePosts = true;
        var currentId = $slider.data('current-id');
        var categories = $slider.data('categories');
        var loadedIds = [currentId];

        // Gather initially loaded post IDs
        $slider.find('.bdf-card').each(function() {
            var pid = $(this).data('post-id');
            if (pid) loadedIds.push(pid);
        });

        // Listen to scroll events on the slider
        $slider.on('scroll', function() {
            if (isAjaxLoading || !hasMorePosts) return;

            // Trigger when user scrolls within 400px of the right end of the slider
            var remainingScroll = slider.scrollWidth - slider.scrollLeft - slider.clientWidth;
            if (remainingScroll < 400) {
                loadMoreRelated();
            }
        });

        function loadMoreRelated() {
            isAjaxLoading = true;
            
            // Add a little indicator at the end
            var $loadingIndicator = $('<div class="bdf-slider-loader" style="display:flex; align-items:center; justify-content:center; flex:0 0 80px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="24" height="24" style="color:#059669; animation: bdfSpin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke="rgba(0,0,0,0.1)"></circle><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path></svg></div>');
            $slider.append($loadingIndicator);

            // Add standard spin animation to head if not present
            if (!$('#bdf-spin-style').length) {
                $('<style id="bdf-spin-style">@keyframes bdfSpin { 100% { transform: rotate(360deg); } }</style>').appendTo('head');
            }

            $.ajax({
                url: '/wp-admin/admin-ajax.php',
                type: 'POST',
                data: {
                    action: 'bdf_load_more_related',
                    exclude: loadedIds,
                    category: categories
                },
                success: function(response) {
                    $loadingIndicator.remove();
                    if (response.success && response.data.html) {
                        var $newCards = $(response.data.html);
                        
                        // Prevent navigation on drag for new cards
                        $newCards.find('a').on('click', function(e) {
                            if (window.bdfSliderDragging) {
                                e.preventDefault();
                                e.stopImmediatePropagation();
                                return false;
                            }
                        });

                        // Prevent browser dragging behavior for new cards
                        $newCards.find('a, img').on('dragstart', function(e) {
                            e.preventDefault();
                        });

                        $slider.append($newCards);

                        // Update loaded IDs
                        $newCards.each(function() {
                            var pid = $(this).data('post-id');
                            if (pid) loadedIds.push(pid);
                        });
                        
                        isAjaxLoading = false;
                    } else {
                        hasMorePosts = false;
                        isAjaxLoading = false;
                    }
                },
                error: function() {
                    $loadingIndicator.remove();
                    isAjaxLoading = false;
                }
            });
        }
    })();

    // ===========================================================================
    // 13. REVIEWS & COMMENTS SYSTEM (Đánh giá & Bình luận)
    // ===========================================================================
    (function initReviewsSystem() {
        const $modal = $('#bdf-review-modal');
        const $starPicker = $('#bdf-modal-star-picker');
        const $ratingVal = $('#bdf-review-rating-value');
        const $ratingLabel = $('#bdf-rating-text-label');

        const starLabels = {
            1: 'Rất tệ (1/5 sao)',
            2: 'Không hài lòng (2/5 sao)',
            3: 'Bình thường (3/5 sao)',
            4: 'Hài lòng / Tốt (4/5 sao)',
            5: 'Tuyệt vời (5/5 sao)'
        };

        // Open modal
        $(document).on('click', '.bdf-open-review-modal', function(e) {
            e.preventDefault();
            const postId = $(this).data('post-id') || $(this).closest('.bdf-reviews-section').data('post-id');
            const title = $(this).data('title') || $(this).closest('.bdf-single-wrapper').data('post-title') || '';

            $('#bdf-review-post-id').val(postId);
            if (title) {
                $('#bdf-review-modal-subtitle').text('Địa điểm: ' + title);
            }
            // Reset to 5 stars
            setPickerStars(5);
            $modal.css('display', 'flex').addClass('active');
            $('body').addClass('bdf-modal-open');
        });

        // Close modal
        function closeReviewModal() {
            $modal.removeClass('active');
            setTimeout(function() {
                $modal.css('display', 'none');
                $('body').removeClass('bdf-modal-open');
            }, 200);
        }

        $(document).on('click', '#bdf-close-review-modal, #bdf-cancel-review-btn', function(e) {
            e.preventDefault();
            closeReviewModal();
        });

        $(document).on('click', '#bdf-review-modal', function(e) {
            if ($(e.target).is('#bdf-review-modal')) {
                closeReviewModal();
            }
        });

        // Star picker click & hover
        function setPickerStars(val) {
            $ratingVal.val(val);
            $starPicker.find('.bdf-picker-star').each(function() {
                const sVal = parseInt($(this).data('val'), 10);
                if (sVal <= val) {
                    $(this).addClass('is-active');
                } else {
                    $(this).removeClass('is-active');
                }
            });
            $ratingLabel.text(starLabels[val] || (val + '/5 sao'));
        }

        $starPicker.on('click', '.bdf-picker-star', function() {
            const val = parseInt($(this).data('val'), 10);
            setPickerStars(val);
        });

        $starPicker.on('mouseenter', '.bdf-picker-star', function() {
            const hoverVal = parseInt($(this).data('val'), 10);
            $starPicker.find('.bdf-picker-star').each(function() {
                const sVal = parseInt($(this).data('val'), 10);
                if (sVal <= hoverVal) {
                    $(this).css('color', '#f59e0b');
                } else {
                    $(this).css('color', '#cbd5e1');
                }
            });
            $ratingLabel.text(starLabels[hoverVal] || (hoverVal + '/5 sao'));
        });

        $starPicker.on('mouseleave', function() {
            const currentVal = parseInt($ratingVal.val() || 5, 10);
            $starPicker.find('.bdf-picker-star').each(function() {
                $(this).css('color', '');
            });
            setPickerStars(currentVal);
        });

        // Submit Review Form
        $('#bdf-review-form').on('submit', function(e) {
            e.preventDefault();
            const $form = $(this);
            const $submitBtn = $('#bdf-submit-review-btn');
            const postId = $('#bdf-review-post-id').val();
            const rating = $ratingVal.val() || 5;
            const author = $('#bdf-review-author-name').val() || '';
            const comment = $('#bdf-review-comment-text').val() || '';

            if (!comment.trim()) {
                alert('Vui lòng nhập nội dung đánh giá.');
                return;
            }

            $submitBtn.prop('disabled', true).addClass('bdf-btn-loading').find('span').text('Đang gửi...');

            $.ajax({
                url: bdfAjax.ajaxUrl,
                type: 'POST',
                dataType: 'json',
                data: {
                    action: 'bdf_submit_review',
                    security: bdfAjax.ajaxNonce,
                    post_id: postId,
                    rating: rating,
                    author_name: author,
                    comment_text: comment
                },
                success: function(res) {
                    $submitBtn.prop('disabled', false).removeClass('bdf-btn-loading').find('span').text('Gửi đánh giá');
                    if (res && res.success) {
                        closeReviewModal();
                        $form[0].reset();
                        setPickerStars(5);

                        // Update reviews list for this post
                        const $list = $('#bdf-reviews-list-' + postId);
                        if ($list.length) {
                            $list.prepend(res.data.review_html);
                        }

                        // Update score & count
                        const $section = $('#bdf-reviews-section-' + postId);
                        if ($section.length) {
                            $section.find('.bdf-rating-score').text(res.data.score);
                            $section.find('.bdf-rating-count').text('(' + res.data.count + ' đánh giá)');
                            if (res.data.stars_html) {
                                $section.find('.bdf-rating-stars').html(res.data.stars_html);
                            }
                        }

                        // Alert / toast
                        alert(res.data.message || 'Đã đăng đánh giá thành công!');
                    } else {
                        alert((res && res.data && res.data.message) ? res.data.message : 'Có lỗi xảy ra, vui lòng thử lại.');
                    }
                },
                error: function() {
                    $submitBtn.prop('disabled', false).removeClass('bdf-btn-loading').find('span').text('Gửi đánh giá');
                    alert('Lỗi kết nối máy chủ, vui lòng thử lại.');
                }
            });
        });

        // Quick Comment Bar submit
        function submitQuickComment($input) {
            const text = $input.val().trim();
            if (!text) return;
            const postId = $input.data('post-id');
            const $section = $input.closest('.bdf-reviews-section');
            const title = $section.closest('.bdf-single-wrapper').data('post-title') || '';

            // If guest user, open modal with text prefilled
            if (!bdfAjax.isLoggedIn) {
                $('#bdf-review-post-id').val(postId);
                if (title) $('#bdf-review-modal-subtitle').text('Địa điểm: ' + title);
                $('#bdf-review-comment-text').val(text);
                setPickerStars(5);
                $modal.css('display', 'flex').addClass('active');
                $('body').addClass('bdf-modal-open');
                $('#bdf-review-author-name').focus();
                return;
            }

            // If logged in, submit directly
            $input.prop('disabled', true);
            $.ajax({
                url: bdfAjax.ajaxUrl,
                type: 'POST',
                dataType: 'json',
                data: {
                    action: 'bdf_submit_review',
                    security: bdfAjax.ajaxNonce,
                    post_id: postId,
                    rating: 5,
                    comment_text: text
                },
                success: function(res) {
                    $input.prop('disabled', false).val('');
                    if (res && res.success) {
                        const $list = $('#bdf-reviews-list-' + postId);
                        if ($list.length) {
                            $list.prepend(res.data.review_html);
                        }
                        if ($section.length) {
                            $section.find('.bdf-rating-score').text(res.data.score);
                            $section.find('.bdf-rating-count').text('(' + res.data.count + ' đánh giá)');
                            if (res.data.stars_html) {
                                $section.find('.bdf-rating-stars').html(res.data.stars_html);
                            }
                        }
                    } else {
                        alert((res && res.data && res.data.message) ? res.data.message : 'Có lỗi xảy ra.');
                    }
                },
                error: function() {
                    $input.prop('disabled', false);
                    alert('Lỗi kết nối máy chủ, vui lòng thử lại.');
                }
            });
        }

        $(document).on('keypress', '.bdf-quick-comment-input', function(e) {
            if (e.which === 13) {
                e.preventDefault();
                submitQuickComment($(this));
            }
        });

        $(document).on('click', '.bdf-action-send', function(e) {
            e.preventDefault();
            const $input = $(this).closest('.bdf-quick-comment-bar').find('.bdf-quick-comment-input');
            submitQuickComment($input);
        });

        // Like button
        $(document).on('click', '.bdf-like-btn', function(e) {
            e.preventDefault();
            const $btn = $(this);
            if ($btn.hasClass('is-active')) return;
            $btn.addClass('is-active');

            const commentId = $btn.data('comment-id');
            const $count = $btn.find('.bdf-like-count');
            let currentLikes = parseInt($count.text() || '0', 10);
            if (isNaN(currentLikes)) currentLikes = 0;
            currentLikes++;
            if ($count.length) {
                $count.text(currentLikes);
            } else {
                $btn.append('<span class="bdf-like-count">' + currentLikes + '</span>');
            }

            if (commentId) {
                $.post(bdfAjax.ajaxUrl, {
                    action: 'bdf_like_review',
                    comment_id: commentId
                });
            }
        });

        // Reply button
        $(document).on('click', '.bdf-reply-btn', function(e) {
            e.preventDefault();
            const author = $(this).data('author') || '';
            const $section = $(this).closest('.bdf-reviews-section');
            const $input = $section.find('.bdf-quick-comment-input');
            if ($input.length && author) {
                $input.val('@' + author + ' ').focus();
                $('html, body').animate({
                    scrollTop: $input.offset().top - 200
                }, 300);
            }
        });

        // Delete Review on Single Location Page (Admin only)
        $(document).on('click', '.bdf-review-delete-btn', function(e) {
            e.preventDefault();
            if (!confirm('Bạn có chắc chắn muốn xóa đánh giá này không?')) return;
            const $btn = $(this);
            const commentId = $btn.data('comment-id');
            const $item = $btn.closest('.bdf-review-item');
            const $section = $btn.closest('.bdf-reviews-section');

            $btn.prop('disabled', true).css('opacity', 0.5);

            $.ajax({
                url: bdfAjax.ajaxUrl,
                type: 'POST',
                dataType: 'json',
                data: {
                    action: 'bdf_delete_review',
                    security: bdfAjax.ajaxNonce,
                    comment_id: commentId
                },
                success: function(res) {
                    if (res && res.success) {
                        $item.slideUp(250, function() {
                            $(this).remove();
                        });
                        if ($section.length && res.data) {
                            $section.find('.bdf-rating-score').text(res.data.score);
                            $section.find('.bdf-rating-count-text').text('(' + res.data.count + ' đánh giá)');
                            $section.find('.bdf-rating-stars-wrap').html(res.data.stars_html);
                        }
                    } else {
                        alert(res && res.data && res.data.message ? res.data.message : 'Lỗi khi xóa đánh giá.');
                        $btn.prop('disabled', false).css('opacity', 1);
                    }
                },
                error: function() {
                    alert('Lỗi kết nối máy chủ. Vui lòng thử lại.');
                    $btn.prop('disabled', false).css('opacity', 1);
                }
            });
        });

        // Hide / Delete Sample Review on Single Location Page (Admin only)
        $(document).on('click', '.bdf-review-delete-sample-btn', function(e) {
            e.preventDefault();
            if (!confirm('Đây là đánh giá mẫu ví dụ. Bạn có muốn ẩn đánh giá này không?')) return;
            const $item = $(this).closest('.bdf-review-item');
            $item.slideUp(250, function() {
                $(this).remove();
            });
        });

        // Delete Review on Dashboard "Quản lý đánh giá" Tab (Admin only)
        $(document).on('click', '.bdf-delete-review-btn', function(e) {
            e.preventDefault();
            if (!confirm('Bạn có chắc chắn muốn xóa vĩnh viễn đánh giá này không?')) return;
            const $btn = $(this);
            const commentId = $btn.data('comment-id');
            const $card = $btn.closest('.bdf-review-admin-card');

            $btn.prop('disabled', true).text('Đang xóa...');

            $.ajax({
                url: bdfAjax.ajaxUrl,
                type: 'POST',
                dataType: 'json',
                data: {
                    action: 'bdf_delete_review',
                    security: bdfAjax.ajaxNonce,
                    comment_id: commentId
                },
                success: function(res) {
                    if (res && res.success) {
                        $card.slideUp(250, function() {
                            $(this).remove();
                            // Update tab button count badge: (X) -> (X-1)
                            const $tabBtn = $('.bdf-dashboard-tab-btn[data-tab="reviews"]');
                            if ($tabBtn.length) {
                                const currentText = $tabBtn.text();
                                const match = currentText.match(/\((\d+)\)/);
                                if (match) {
                                    const newCount = Math.max(0, parseInt(match[1], 10) - 1);
                                    $tabBtn.html($tabBtn.html().replace(/\(\d+\)/, '(' + newCount + ')'));
                                }
                            }
                            // If no reviews left in the list
                            if ($('.bdf-reviews-admin-list .bdf-review-admin-card').length === 0) {
                                $('#bdf-pane-reviews').html(`
                                    <div class="bdf-empty-dashboard">
                                        <div class="bdf-empty-icon">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="margin:0 auto; display:block;">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                            </svg>
                                        </div>
                                        <h3>Chưa có đánh giá nào trên hệ thống</h3>
                                        <p>Các đánh giá và bình luận từ khách hàng trên toàn bộ các địa điểm sẽ hiển thị tại đây.</p>
                                    </div>
                                `);
                            }
                        });
                    } else {
                        alert(res && res.data && res.data.message ? res.data.message : 'Lỗi khi xóa đánh giá.');
                        $btn.prop('disabled', false).text('Xóa đánh giá');
                    }
                },
                error: function() {
                    alert('Lỗi kết nối máy chủ. Vui lòng thử lại.');
                    $btn.prop('disabled', false).text('Xóa đánh giá');
                }
            });
        });
    })();

});
