// Quick-start weekly menus for chefs. Each day has courses; a course with two options
// lets customers choose (e.g. Paneer bhurji OR Aloo gobi).

(function () {
  const C = (id, label, ...options) => ({ id, label, options });
  const day = (sabzi, dal, bread, sides) => ({
    courses: [
      C('sabzi', 'Sabzi', ...[].concat(sabzi)),
      C('dal', 'Dal / curry', ...[].concat(dal)),
      C('bread', 'Roti & rice', ...[].concat(bread)),
      C('sides', 'Sides', ...[].concat(sides))
    ]
  });

  const PRESETS = {
    north_indian: {
      label: 'North Indian',
      weekly: {
        monday: day(['Paneer Bhurji', 'Aloo Gobi'], 'Dal Makhani', ['Phulka + Jeera Rice', 'Paratha + Jeera Rice'], 'Boondi Raita'),
        tuesday: day('Bhindi Masala', 'Dal Tadka', 'Phulka + Steamed Rice', 'Kachumber Salad'),
        wednesday: day(['Kadhai Paneer', 'Mix Veg'], 'Rajma', 'Phulka + Basmati Rice', 'Mint Chutney'),
        thursday: day('Baingan Bharta', 'Panchmel Dal', 'Multigrain Roti + Matar Pulao', 'Gulab Jamun'),
        friday: day(['Mix Veg Handi', 'Aloo Matar'], 'Chole', 'Phulka + Jeera Pulao', 'Sirka Onion + Papad'),
        saturday: day('Methi Matar Malai', 'Yellow Dal Fry', 'Phulka + Steamed Rice', 'Pickle + Papad'),
        sunday: day('Paneer Butter Masala', 'Dal Makhani', ['Poori + Pulao', 'Paratha + Pulao'], 'Moong Dal Halwa')
      }
    },
    gujarati: {
      label: 'Gujarati',
      weekly: {
        monday: day(['Sev Tameta', 'Bateta Nu Shaak'], 'Gujarati Kadhi', 'Rotli + Steamed Rice', 'Kachumber + Chhundo'),
        tuesday: day('Ringan No Olo', 'Tuvar Dal', 'Bajra Rotla + Khichdi', 'Gol + Garlic Chutney'),
        wednesday: day('Bateta Rasawala', 'Moong Dal', 'Rotli + Jeera Rice', 'Sambharo'),
        thursday: day(['Dudhi Chana', 'Bhinda Sambhariya'], 'Kathiawadi Kadhi', 'Rotli + Masala Bhat', 'Chaas'),
        friday: day('Bhinda Sambhariya', 'Gujarati Dal', 'Rotli + Steamed Rice', 'Khaman'),
        saturday: day('Valor Muthia', 'Gujarati Dal', 'Rotli + Veg Pulao', 'Papad + Salad'),
        sunday: day('Undhiyu', 'Meethi Dal', 'Poori + Shrikhand', 'Jalebi + Chaas')
      }
    },
    punjabi: {
      label: 'Punjabi',
      weekly: {
        monday: day(['Shahi Paneer', 'Aloo Shimla Mirch'], 'Dal Makhani', 'Tawa Roti + Jeera Rice', 'Mixed Raita'),
        tuesday: day('Bhindi Do Pyaza', 'Yellow Dal Tadka', 'Butter Phulka + Rice', 'Amritsari Achaar'),
        wednesday: day('Kadhi Pakora', 'Rajma Masala', 'Phulka + Steamed Rice', 'Kachumber'),
        thursday: day(['Matar Paneer', 'Aloo Gobi'], 'Kali Dal', 'Phulka + Peas Pulao', 'Boondi Raita'),
        friday: day('Sarson Ka Saag', 'Chana Dal', 'Makki Roti + Rice', 'White Butter + Gur'),
        saturday: day('Amritsari Chole', 'Moong Dal', 'Kulcha + Jeera Pulao', 'Pickled Onion'),
        sunday: day('Butter Paneer', 'Langar Dal', ['Laccha Paratha + Pulao', 'Phulka + Pulao'], 'Kheer')
      }
    },
    comfort: {
      label: 'Light comfort',
      weekly: {
        monday: day('Lauki Chana Dal', 'Moong Dal', 'Phulka + Steamed Rice', 'Cucumber Salad + Chaas'),
        tuesday: day(['Tinda Masala', 'Turai Sabzi'], 'Toor Dal', 'Phulka + Brown Rice', 'Fresh Curd'),
        wednesday: day('Gobi Matar', 'Masoor Dal', 'Multigrain Roti + Rice', 'Green Salad'),
        thursday: day('Turai Sabzi', 'Yellow Moong Dal', 'Phulka + Veg Khichdi', 'Carrot Salad'),
        friday: day('Lauki Kofta', 'Chana Dal', 'Phulka + Jeera Rice', 'Mint Raita'),
        saturday: day('Methi Aloo', 'Mixed Dal', 'Phulka + Steamed Rice', 'Sprouts Salad'),
        sunday: day(['Paneer Bhurji', 'Veg Stew'], 'Dal Tadka', 'Phulka + Veg Pulao', 'Fruit Chaat')
      }
    }
  };

  window.MenuPresets = PRESETS;
})();
