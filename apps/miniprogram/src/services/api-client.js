/** @returns {{apiBaseUrl: string, accessToken: string}} */
function getAppConfig() {
	return getApp().globalData;
}

/**
 * @param {{url: string, method?: 'GET'|'POST'|'PUT'|'DELETE', data?: any}} options
 * @returns {Promise<any>}
 */
export function request({ url, method = "GET", data }) {
	const { apiBaseUrl, accessToken } = getAppConfig();

	return new Promise((resolve, reject) => {
		wx.request({
			url: `${apiBaseUrl}${url}`,
			method,
			data,
			header: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
			success: (response) => {
				if (response.statusCode >= 200 && response.statusCode < 300) {
					resolve(response.data);
					return;
				}
				reject(new Error(`API request failed: ${response.statusCode}`));
			},
			fail: reject,
		});
	});
}
