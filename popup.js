document.addEventListener('DOMContentLoaded', async () => {
  const elementInput = document.getElementById('elementInput');
  const addElementButton = document.getElementById('addElementButton');
  const elementListContainer = document.getElementById('elementList');
  const inputHint = document.getElementById('inputHint');

  let savedElements = [];

  // --- Utility Functions ---

  // Function to show the input hint
  function showInputHint() {
    inputHint.style.display = 'block';
  }

  // Function to hide the input hint
  function hideInputHint() {
    inputHint.style.display = 'none';
  }

  // Save elements to Chrome Storage
  async function saveSettings() {
    await chrome.storage.sync.set({ savedElements });
  }

  // Load elements from Chrome Storage
  async function loadSettings() {
    const result = await chrome.storage.sync.get(['savedElements']);
    savedElements = result.savedElements || [];
    // Ensure old entries have isFound property
    savedElements.forEach((item) => {
      if (typeof item.isFound === 'undefined') {
        item.isFound = false; // Default to false, will be updated by sync
      }
    });
    await syncElementStatesWithPage();
  }

  // Render the list of elements in the popup
  function renderList() {
    elementListContainer.innerHTML = '';
    if (savedElements.length === 0) {
      elementListContainer.innerHTML =
        '<p class="text-sm text-gray-500">No elements added yet.</p>';
      return;
    }

    savedElements.forEach((item, index) => {
      const listItem = document.createElement('div');
      listItem.className = 'list-item';

      const prefix = item.type === 'id' ? '#' : '.';
      let visibilityIconChar; // Character for the icon
      let iconClass = 'visibility-icon'; // Base class

      if (item.isFound) {
        visibilityIconChar = item.isHidden ? '🚫' : '👁️'; // Crossed-out eye for hidden, eye for visible
      } else {
        visibilityIconChar = '🙁'; // Changed to unhappy face emoji
        iconClass += ' icon-not-found'; // Add specific class for gray color
      }

      listItem.innerHTML = `
                <div class="list-item-content">
                    <span>${prefix}${item.value}</span>
                    <div class="list-item-controls">
                        <span class="${iconClass}" data-index="${index}">${visibilityIconChar}</span>
                        <button class="remove-btn" data-index="${index}">Remove</button>
                    </div>
                </div>
            `;
      elementListContainer.appendChild(listItem);
    });

    // Attach event listeners to new remove buttons
    document.querySelectorAll('.remove-btn').forEach((button) => {
      button.onclick = handleRemoveItem;
    });

    // Attach event listeners to visibility icons (only if element is found)
    document.querySelectorAll('.visibility-icon').forEach((icon) => {
      const index = parseInt(icon.dataset.index);
      if (savedElements[index] && savedElements[index].isFound) {
        icon.onclick = handleToggleSpecificElement;
        icon.style.cursor = 'pointer'; // Ensure cursor indicates clickability
      } else {
        icon.onclick = null; // Remove click handler
        icon.style.cursor = 'default'; // Make not-found icon not clickable
      }
    });
  }

  // Handle adding a new element
  addElementButton.addEventListener('click', async () => {
    const input = elementInput.value.trim();
    if (!input) {
      hideInputHint(); // Hide hint if input is just empty
      return;
    }

    let type;
    let value;

    if (input.startsWith('#')) {
      type = 'id';
      value = input.substring(1); // Remove '#'
    } else if (input.startsWith('.')) {
      type = 'class';
      value = input.substring(1); // Remove '.'
    } else {
      showInputHint(); // Show hint if invalid prefix
      return;
    }

    if (!value) {
      showInputHint(); // Show hint if value is empty after prefix
      return;
    }

    // Check for duplicates
    const isDuplicate = savedElements.some(
      (item) => item.type === type && item.value === value,
    );
    if (isDuplicate) {
      hideInputHint(); // Hide hint if it's a duplicate
      return;
    }

    // If validation passes, hide the hint
    hideInputHint();

    // Add new element with default visible state and not-found status (will be synced later)
    const newItem = { type, value, isHidden: false, isFound: false };
    savedElements.push(newItem);
    elementInput.value = ''; // Clear input

    await saveSettings();
    renderList(); // Render immediately to show the new item in the list

    // Now, attempt to hide the newly added element on the page
    const tab = await getActiveTabAndInjectScript();
    if (tab) {
      chrome.tabs.sendMessage(
        tab.id,
        {
          action: 'hide', // Explicitly hide this new item
          ids: newItem.type === 'id' ? [newItem.value] : [],
          classes: newItem.type === 'class' ? [newItem.value] : [],
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "Error sending 'hide' message on add:",
              chrome.runtime.lastError.message,
            );
          }
          // After sending hide, sync states to confirm it's hidden and update isFound
          syncElementStatesWithPage();
        },
      );
    } else {
      // If tab is not available, just sync to mark as not found
      syncElementStatesWithPage();
    }
  });

  // Handle removing an item from the list
  async function handleRemoveItem(event) {
    const button = event.target;
    const index = parseInt(button.dataset.index);

    if (index >= 0 && index < savedElements.length) {
      const removedItem = savedElements[index]; // Get the item before removing it

      // Attempt to show the element on the page
      const tab = await getActiveTabAndInjectScript();
      if (tab) {
        chrome.tabs.sendMessage(
          tab.id,
          {
            action: 'show', // Explicitly show this item
            ids: removedItem.type === 'id' ? [removedItem.value] : [],
            classes: removedItem.type === 'class' ? [removedItem.value] : [],
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error sending 'show' message on remove:",
                chrome.runtime.lastError.message,
              );
            }
            // No need to update UI based on this response, as item is being removed anyway
          },
        );
      }

      savedElements.splice(index, 1); // Remove the item from saved list
      await saveSettings();
      renderList(); // Re-render after removal
    }
  }

  // --- Core Logic for Communicating with Content Script ---

  // Function to get the active tab and inject content script if needed
  async function getActiveTabAndInjectScript() {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // More comprehensive check for restricted URLs
    const restrictedUrls = [
      'chrome://',
      'edge://',
      'about:',
      'https://chrome.google.com/webstore',
      'chrome-extension://',
      'view-source:',
      'file:///',
    ];

    if (
      !tab ||
      !tab.id ||
      restrictedUrls.some((prefix) => tab.url.startsWith(prefix))
    ) {
      console.error(
        'Cannot apply action on this page (restricted URL or invalid tab). Current URL:',
        tab ? tab.url : 'N/A',
      );
      return null;
    }

    try {
      // Check if content script is already injected. If not, inject it.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
    } catch (e) {
      console.error('Error injecting content script:', e);
      return null;
    }
    return tab;
  }

  // Synchronize the popup's savedElements with the actual state on the page
  async function syncElementStatesWithPage() {
    const tab = await getActiveTabAndInjectScript();
    if (!tab) {
      // If tab is invalid/restricted, mark all saved elements as not found
      savedElements.forEach((item) => (item.isFound = false));
      renderList();
      return;
    }

    // Prepare data to send to content script to get status
    const elementsToQuery = savedElements.map((item) => ({
      type: item.type,
      value: item.value,
    }));

    if (elementsToQuery.length === 0) {
      renderList(); // Just render if no elements to query
      return;
    }

    chrome.tabs.sendMessage(
      tab.id,
      {
        action: 'get_status',
        elements: elementsToQuery,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            'Error sending message for status sync:',
            chrome.runtime.lastError.message,
          );
          // If connection fails, assume all elements are not found for visual consistency
          savedElements.forEach((item) => (item.isFound = false));
          renderList();
          return;
        }
        if (
          response &&
          response.status === 'success' &&
          response.updatedElements
        ) {
          // Update savedElements based on the actual state from the page
          savedElements.forEach((savedItem) => {
            const updatedItem = response.updatedElements.find(
              (ui) =>
                ui.type === savedItem.type && ui.value === savedItem.value,
            );
            if (updatedItem) {
              savedItem.isHidden = updatedItem.isHidden;
              savedItem.isFound = updatedItem.isFound;
            } else {
              // If content script didn't report on it, it means it wasn't found
              savedItem.isFound = false;
            }
          });
          saveSettings(); // Save the synchronized state
          renderList(); // Re-render the list with accurate icons
        } else if (response && response.status === 'error') {
          console.error(
            `Error from content script during status sync: ${response.message}`,
          );
          // If there's an error, assume elements are not found for now
          savedElements.forEach((item) => (item.isFound = false));
          renderList();
        }
      },
    );
  }

  // Handle toggling a specific element's visibility
  async function handleToggleSpecificElement(event) {
    const icon = event.target;
    const index = parseInt(icon.dataset.index);

    if (index >= 0 && index < savedElements.length) {
      const elementToToggle = savedElements[index];

      // Only proceed if the element is found on the page
      if (!elementToToggle.isFound) {
        console.log(
          `Element ${elementToToggle.value} not found on page, cannot toggle.`,
        );
        return;
      }

      const currentIsHidden = elementToToggle.isHidden;
      const newAction = currentIsHidden ? 'show' : 'hide';

      const tab = await getActiveTabAndInjectScript();
      if (!tab) return;

      chrome.tabs.sendMessage(
        tab.id,
        {
          action: newAction,
          ids: elementToToggle.type === 'id' ? [elementToToggle.value] : [],
          classes:
            elementToToggle.type === 'class' ? [elementToToggle.value] : [],
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              'Error sending message for specific toggle:',
              chrome.runtime.lastError.message,
            );
            return;
          }

          if (
            response &&
            response.status === 'success' &&
            response.updatedElements
          ) {
            // Update the local state based on the actual state returned by content.js
            response.updatedElements.forEach((updatedItem) => {
              const foundIndex = savedElements.findIndex(
                (se) =>
                  se.type === updatedItem.type &&
                  se.value === updatedItem.value,
              );
              if (foundIndex !== -1) {
                savedElements[foundIndex].isHidden = updatedItem.isHidden;
                savedElements[foundIndex].isFound = updatedItem.isFound;
              }
            });
            saveSettings();
            renderList();
          } else if (response && response.status === 'error') {
            console.error(
              `Error from content script during specific toggle: ${response.message}`,
            );
          }
        },
      );
    }
  }

  // Initial load of settings when popup opens
  loadSettings();
});
