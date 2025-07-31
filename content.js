// This script runs in the context of the web page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request.action;
  let elementsToProcess = [];

  // Determine which elements to process based on the action
  if (action === 'get_status') {
    elementsToProcess = request.elements || []; // Elements sent for status query
  } else {
    // For hide, show, toggle actions, combine IDs and Classes
    const ids = (request.ids || []).map((id) => ({ type: 'id', value: id }));
    const classes = (request.classes || []).map((cls) => ({
      type: 'class',
      value: cls,
    }));
    elementsToProcess = [...ids, ...classes];
  }

  const updatedElementsStatus = []; // To store the final status of processed elements

  try {
    elementsToProcess.forEach((item) => {
      let element = null;
      let isFound = false;
      let isHidden = false; // Default to not hidden

      if (item.type === 'id') {
        element = document.getElementById(item.value);
        if (element) {
          isFound = true;
          isHidden = element.style.display === 'none';
        }
      } else if (item.type === 'class') {
        // For classes, check if at least one element with this class exists
        const elements = document.querySelectorAll(`.${item.value}`);
        if (elements.length > 0) {
          element = elements[0]; // Use the first found element for status/toggle
          isFound = true;
          isHidden = element.style.display === 'none';
        }
      }

      if (isFound) {
        // Only apply actions if element was found
        if (action === 'hide') {
          if (item.type === 'id') {
            element.style.display = 'none';
          } else if (item.type === 'class') {
            document
              .querySelectorAll(`.${item.value}`)
              .forEach((el) => (el.style.display = 'none'));
          }
          isHidden = true;
        } else if (action === 'show') {
          if (item.type === 'id') {
            element.style.display = ''; // Reset to default display
          } else if (item.type === 'class') {
            document
              .querySelectorAll(`.${item.value}`)
              .forEach((el) => (el.style.display = ''));
          }
          isHidden = false;
        } else if (action === 'toggle') {
          if (item.type === 'id') {
            if (element.style.display === 'none') {
              element.style.display = '';
              isHidden = false;
            } else {
              element.style.display = 'none';
              isHidden = true;
            }
          } else if (item.type === 'class') {
            // For class toggle, we need to apply to all elements with that class
            const elementsToToggle = document.querySelectorAll(
              `.${item.value}`,
            );
            if (elementsToToggle.length > 0) {
              // Determine the common state to toggle from (e.g., if any are visible, hide all)
              const anyVisible = Array.from(elementsToToggle).some(
                (el) => el.style.display !== 'none',
              );
              const targetDisplay = anyVisible ? 'none' : '';
              elementsToToggle.forEach(
                (el) => (el.style.display = targetDisplay),
              );
              isHidden = anyVisible; // If any were visible, now they are hidden
            }
          }
        }
        // For 'get_status', isHidden is already correctly set based on current display
      }
      updatedElementsStatus.push({
        type: item.type,
        value: item.value,
        isHidden: isHidden,
        isFound: isFound,
      });
    });

    sendResponse({ status: 'success', updatedElements: updatedElementsStatus });
  } catch (e) {
    console.error('Error modifying elements:', e);
    sendResponse({
      status: 'error',
      message: `Failed to modify elements: ${e.message}`,
    });
  }
  return true;
});
