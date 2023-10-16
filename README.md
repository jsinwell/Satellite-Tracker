# Satellite Tracker

## Description
A real-time satellite tracking application built with [Cesium](https://cesium.com/), [satellite-js](https://github.com/shashwatak/satellite-js), and utilizes data provided by [NORAD](https://www.norad.mil/). 

## Features
- **Real-time Satellite Tracking**: Visualize satellites moving in real-time with data updated periodically.
- **Interactive Interface**: Users can interact with the Cesium interface to pan around and focus on specific satellites.
- **Search Functionality**: Users can quickly track specific satellites using the search bar.
- **Satellite Information**: Displays information about a select few satellites (like the ISS) when selected.
- **Customizable View**: Toggle features like skybox and globe lighting to customize the viewing experience.
- **Efficient Data Processing**: Utilizes Web Workers to significantly reduce load times.

## Limitations
- The tracking results may have a small margin of error due to outdated Two-Line Element Set (TLE) data and orbital perturbations not accounted for in the model.

## Data Source
The application uses Node.js and axios to retrieve up-to-date TLE data from [CelesTrak](https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle).

## Usage
1. **Launch the Application**: Start the application and you will see Earth with satellites marked with different colors based on their types.
2. **Search and Select**: Use the search bar to find specific satellites. Select a satellite to view its information and track its movement.
3. **Customize View**: Use the provided buttons to toggle the skybox and globe lighting to enhance your viewing experience.

## Acknowledgments
- Thanks to NORAD for providing the satellite data.
- Built with the open-source Cesium and satellite-js libraries.
